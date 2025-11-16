# --- 1. Configuración de Terraform y el Proveedor de AWS ---

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0" # Usa la versión 5.x del proveedor de AWS
    }
  }
}

provider "aws" {
  region = "us-east-1" # La misma región que tu API
}

# --- 2. La Base: Red (VPC) ---
# Crearemos una VPC dedicada para Airflow

resource "aws_vpc" "airflow_vpc" {
  cidr_block = "10.0.0.0/16" # Un rango de IP privado para tu VPC

  # Queremos que los contenedores Fargate obtengan IPs públicas
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "airflow-vpc"
  }
}

# --- 3. Subnets Públicas ---
# Necesitamos al menos dos subnets en zonas de disponibilidad
# diferentes para que servicios como RDS y Fargate funcionen.

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.airflow_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true # Importante para Fargate

  tags = {
    Name = "airflow-subnet-public-a"
  }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.airflow_vpc.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true

  tags = {
    Name = "airflow-subnet-public-b"
  }
}

# --- 4. Acceso a Internet (Gateway y Tabla de Rutas) ---
# Los contenedores necesitan salir a internet para, por ejemplo,
# descargar paquetes o imágenes de Docker.

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.airflow_vpc.id

  tags = {
    Name = "airflow-igw"
  }
}

resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.airflow_vpc.id

  route {
    cidr_block = "0.0.0.0/0" # Cualquier tráfico
    gateway_id = aws_internet_gateway.gw.id # va al Internet Gateway
  }

  tags = {
    Name = "airflow-public-rt"
  }
}

# --- 5. Asociar las Subnets a la Tabla de Rutas ---

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public_rt.id
}

# --- 6. Grupo de Subnets para la BD ---
# RDS necesita saber en qué subnets de tu VPC vivir.
resource "aws_db_subnet_group" "airflow_db_subnet_group" {
  name       = "airflow-db-subnet-group"
  subnet_ids = [aws_subnet.public_a.id, aws_subnet.public_b.id] # Usa las subnets que ya creamos

  tags = {
    Name = "Airflow DB Subnet Group"
  }
}

# --- 7. Firewall de la Base de Datos (Security Group) ---
# Esto define quién puede "hablar" con tu base de datos.
resource "aws_security_group" "rds_sg" {
  name        = "airflow-rds-sg"
  description = "Permitir tráfico de Postgres solo desde dentro de la VPC"
  vpc_id      = aws_vpc.airflow_vpc.id

  # Regla de entrada: Permitir conexiones al puerto de Postgres (5432)
  # solo desde cualquier IP DENTRO de tu VPC (10.0.0.0/16).
  # Así tus contenedores Fargate podrán conectarse a ella.
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.airflow_vpc.cidr_block]
  }

  # Regla de salida: Permitir que la BD responda.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "airflow-rds-sg"
  }
}

# --- 8. La Instancia de Base de Datos (El Metastore) ---
# Esta es la base de datos física que Airflow usará.
resource "aws_db_instance" "airflow_metastore" {
  identifier           = "airflow-metastore-db"
  engine               = "postgres"
  engine_version       = "15.5"        # Una versión moderna
  instance_class       = "db.t3.micro" # La más barata, ideal para tu lab
  allocated_storage    = 20            # 20 GB de espacio
  storage_type         = "gp2"
  
  db_name              = "airflow_metastore"      # Nombre de la base de datos
  username             = "airflow_admin"          # Usuario
  
  # 🚨 ADVERTENCIA 🚨
  # NUNCA pongas contraseñas en texto plano en un proyecto real.
  # Para un lab de AWS Academy (que se autodestruye) está bien.
  # En producción, esto se maneja con AWS Secrets Manager.
  password             = "TuPasswordSuperSegura123!" 

  db_subnet_group_name   = aws_db_subnet_group.airflow_db_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]

  # Para tu lab, esto evita costos y problemas al borrar
  skip_final_snapshot  = true
  publicly_accessible = false # ¡Importante! No debe ser accesible desde Internet

  tags = {
    Name = "airflow-metastore"
  }
}

# --- 9. El Cluster de ECS (La "Fábrica") ---
# Es el "parque industrial" donde vivirán tus contenedores.

resource "aws_ecs_cluster" "airflow_cluster" {
  name = "airflow-cluster"
}

# --- 10. Grupo de Logs (Para ver errores) ---
# Necesitamos un lugar para ver los logs de Airflow.

resource "aws_cloudwatch_log_group" "airflow_logs" {
  name              = "/ecs/airflow"
  retention_in_days = 7 # Guarda logs por 7 días
}

# --- 11. Permisos para Fargate (Rol de Ejecución) ---
# Fargate necesita permisos para descargar tu imagen de Docker
# y enviar logs a CloudWatch.

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "airflow-ecs-task-execution-role"

  # Le dice a AWS que el servicio ECS puede asumir este rol
  assume_role_policy = jsonencode({
    Version   = "2012-10-17",
    Statement = [
      {
        Action    = "sts:AssumeRole",
        Effect    = "Allow",
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Adjuntamos la política de permisos estándar de AWS
resource "aws_iam_role_policy_attachment" "ecs_task_execution_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# --- 12. Firewall del Contenedor (Security Group) ---
# Define quién puede "hablar" con tu contenedor Fargate.

resource "aws_security_group" "fargate_sg" {
  name        = "airflow-fargate-sg"
  description = "Permitir tráfico al webserver de Airflow"
  vpc_id      = aws_vpc.airflow_vpc.id

  # Regla de entrada: Permitir acceso al puerto 8080 (web de Airflow)
  # desde CUALQUIER IP. (En producción, deberías restringir esto a tu IP).
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Regla de salida: Permitir que el contenedor hable con el exterior
  # (para conectarse a la BD, a S3, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "airflow-fargate-sg"
  }
}

# --- 13. Definición de Tarea (El "Plano" del Contenedor) ---
# Esta es la receta exacta de tu contenedor Airflow.
# Simplificaremos y pondremos el Webserver y el Scheduler en
# un solo contenedor por ahora (usando LocalExecutor).

resource "aws_ecs_task_definition" "airflow_task" {
  family                   = "airflow-task"
  requires_compatibilities = ["FARGATE"]      # Le dice que use Fargate
  network_mode             = "awsvpc"         # Requerido por Fargate
  cpu                      = 2048             # 2 vCPU
  memory                   = 4096             # 4 GB de RAM
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  # Definición del contenedor en sí
  container_definitions = jsonencode([
    {
      name      = "airflow"
      # 🚨 ¡ATENCIÓN! 🚨
      # Esta imagen es PÚBLICA (de Apache). NO está lista para producción.
      # En un paso futuro, debes construir tu PROPIA imagen (con tu DAG)
      # y subirla a ECR (el registro de contenedores de AWS).
      image     = "apache/airflow:2.8.1"
      cpu       = 2048
      memory    = 4096
      portMappings = [
        {
          containerPort = 8080
          protocol      = "tcp"
        }
      ]
      # Variables de entorno que Airflow necesita
      environment = [
        {
          name  = "AIRFLOW__CORE__EXECUTOR",
          value = "LocalExecutor" # El más simple para empezar
        },
        {
          name  = "AIRFLOW__DATABASE__SQL_ALCHEMY_CONN",
          # Construye la URL de conexión a la BD que creamos
          value = "postgresql+psycopg2://${aws_db_instance.airflow_metastore.username}:${aws_db_instance.airflow_metastore.password}@${aws_db_instance.airflow_metastore.address}:${aws_db_instance.airflow_metastore.port}/${aws_db_instance.airflow_metastore.db_name}"
        },
        {
          name  = "AIRFLOW__CORE__LOAD_EXAMPLES", # No cargar DAGs de ejemplo
          value = "false"
        }
      ]
      # Configuración de logs
      logConfiguration = {
        logDriver = "awslogs",
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.airflow_logs.name,
          "awslogs-region"        = "us-east-1",
          "awslogs-stream-prefix" = "airflow"
        }
      }
    }
  ])
}

# --- 14. El Servicio (El "Gerente" de Fargate) ---
# Esto es lo que MANTIENE tu contenedor corriendo 24/7.
# Es la pieza que estabas esperando.

resource "aws_ecs_service" "airflow_service" {
  name            = "airflow-service"
  cluster         = aws_ecs_cluster.airflow_cluster.id
  task_definition = aws_ecs_task_definition.airflow_task.arn
  launch_type     = "FARGATE"
  desired_count   = 1 # Queremos que 1 copia esté siempre corriendo

  # Le dice a Fargate en qué red debe vivir
  network_configuration {
    subnets = [
      aws_subnet.public_a.id,
      aws_subnet.public_b.id
    ]
    security_groups = [aws_security_group.fargate_sg.id]
    assign_public_ip = true # Dale una IP pública para que podamos acceder a la UI
  }

  # Espera a que la BD esté lista antes de intentar iniciar el servicio
  depends_on = [aws_db_instance.airflow_metastore]

  tags = {
    Name = "airflow-service"
  }
}