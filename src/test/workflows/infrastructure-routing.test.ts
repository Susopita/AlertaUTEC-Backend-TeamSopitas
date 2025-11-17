/**
 * Infra test: valida que serverless.yml mapea los eventos a las colas correctas
 * No parseamos YAML con tipos CFN; verificamos el contenido con búsquedas simples.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Infrastructure routing (serverless.yml)', () => {
  const slsPath = join(process.cwd(), 'serverless.yml');
  const yaml = readFileSync(slsPath, 'utf8');

  it('CreaciónIncidente → QueueIncidentes', () => {
    const block = yaml.split('\n').join('\n');
    expect(block).toMatch(/RuleCreacionIncidente:[\s\S]*detail-type:[\s\S]*-\s+IncidenteCreado/);
    expect(block).toMatch(/RuleCreacionIncidente:[\s\S]*Targets:[\s\S]*Arn:\s*!GetAtt\s+QueueIncidentes\.Arn/);
  });

  it('ActualizaciónIncidente (+Priorizar) → QueueIncidentes', () => {
    expect(yaml).toMatch(/RuleActualizacionIncidente:[\s\S]*detail-type:[\s\S]*-\s+IncidenteActualizado[\s\S]*-\s+PriorizarIncidente/);
    expect(yaml).toMatch(/RuleActualizacionIncidente:[\s\S]*Arn:\s*!GetAtt\s+QueueIncidentes\.Arn/);
  });

  it('IncidenteEliminado → QueueIncidentes', () => {
    expect(yaml).toMatch(/RuleIncidenteEliminado:[\s\S]*-\s+IncidenteEliminado/);
    expect(yaml).toMatch(/RuleIncidenteEliminado:[\s\S]*Arn:\s*!GetAtt\s+QueueIncidentes\.Arn/);
  });

  it('IncidenteEnAtencion → QueueIncidentes', () => {
    expect(yaml).toMatch(/RuleIncidenteEnAtencion:[\s\S]*-\s+IncidenteEnAtencion/);
    expect(yaml).toMatch(/RuleIncidenteEnAtencion:[\s\S]*Arn:\s*!GetAtt\s+QueueIncidentes\.Arn/);
  });

  it('IncidenteResuelto (+CerrarIncidente) → QueueIncidentes', () => {
    expect(yaml).toMatch(/RuleIncidenteResuelto:[\s\S]*-\s+IncidenteResuelto[\s\S]*-\s+CerrarIncidente/);
    expect(yaml).toMatch(/RuleIncidenteResuelto:[\s\S]*Arn:\s*!GetAtt\s+QueueIncidentes\.Arn/);
  });

  it('ClasificaciónRequerida (Creado, Actualizado) → QueueOrquestacion', () => {
    expect(yaml).toMatch(/RuleClasificacionRequerida:[\s\S]*-\s+IncidenteCreado[\s\S]*-\s+IncidenteActualizado/);
    expect(yaml).toMatch(/RuleClasificacionRequerida:[\s\S]*Arn:\s*!GetAtt\s+QueueOrquestacion\.Arn/);
  });
});
