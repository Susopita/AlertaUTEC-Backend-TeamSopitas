# Usa la misma imagen base que definimos en la Task Definition de Terraform
FROM apache/airflow:2.8.1-python3.11

# Instala las dependencias de Python necesarias:
# boto3: para AWS (DynamoDB, S3, Athena)
# apache-airflow-providers-amazon: para operadores nativos de Airflow
USER root
RUN pip install --no-cache-dir \
    boto3 \
    apache-airflow-providers-amazon
USER airflow

# Copia tu DAG al contenedor
COPY dags/ /opt/airflow/dags/