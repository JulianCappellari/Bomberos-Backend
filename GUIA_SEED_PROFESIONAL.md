# Seed profesional de demostracion

Datos sinteticos para probar el sistema, no para operar emergencias ni realizar pagos reales.

## Ejecutar

Desde `Bomberos - Backend`:

```powershell
npm run seed:demo
```

El comando aplica las migraciones y agrega los escenarios exclusivamente a `bomberos_demo`, usando la conexion PostgreSQL de `.env`. Nunca siembra `public`, no elimina esquemas y rechaza bases con registros ajenos a la demostracion. No modifica `.env`.

Para verlos en la app, el backend debe usar `schema=bomberos_demo` en su `DATABASE_URL`. Reiniciarlo si se cambia esa configuracion. No modificar usuario, clave, host o nombre de base de esa URL.

Todas las cuentas NUEVAS usan esta clave salvo que se configure `SEED_PASSWORD`:

```text
BomberosSampacho2026!
```

Si ya existian, se conservan sus claves. Para restablecer explicitamente las nueve cuentas principales:

```powershell
npm run seed:demo -- --reset-passwords
```

Ese restablecimiento no reactiva cuentas ni cambia cargos; revoca sesiones de las cuentas cuya clave cambio. No restablece las cuentas auxiliares.

## Datos de una carga limpia

| Modulo | Cantidad de referencia |
| --- | ---: |
| Usuarios de distintos cargos y estados | 18 |
| Bases / moviles | 2 / 6 |
| Turnos diurnos y nocturnos | 90 |
| Participaciones en guardias y servicios | 176 |
| Alertas / intervenciones | 15 / 17 |
| Planillas de intervencion | 5 (4 completas nuevas y 1 operativa abierta anterior) |
| Controles / items de inventario | 14 / 79 |
| Tareas / transferencias de tareas | 34 / 4 |
| Intercambios de guardia | 3 |
| Gastos con foto privada | 8 |
| Avales de gastos / constancias de pago | 8 / 3 |
| Cursos / correcciones de presencia | 3 / 3 |
| Prendas institucionales / declaraciones personales | 22 / 80 |
| Mensajes | 17 |
| Cargas de combustible / viajes de agua | 11 / 13 |
| Cilindros ERA / compresores | 7 / 2 |

Las cantidades temporales pueden variar segun el horario de la primera carga: no se crea asistencia de un turno que aun no termino. Las prendas declaradas son distintas de las entregas institucionales.

## Que cuenta usar

| Cuenta | Perfil y escenarios principales |
| --- | --- |
| `demo.admin` | Administrador tecnico: personal, permisos, auditoria, finanzas y ranking. No debe probarse como bombero ni sumar puntaje personal. |
| `demo.oficial` | Oficial con jefatura financiera: revisar gastos, viajes y trabajos; su propio gasto necesita avales independientes de suboficiales. |
| `demo.subjefe` | Segundo oficial: supervision independiente, avales y decisiones de jefatura. |
| `demo.operador` | Suboficial: administracion limitada, aval de trabajos y primer autorizante del gasto de oficial. |
| `demo.bombero` | Cuenta operativa general: prendas y licencias declaradas, tareas, gastos, controles, mensajes y participaciones historicas. Buen punto de partida para el recorrido de usuario. |
| `demo.sofia` | Bombera con permiso especial FLEET; responsable de flota, trabajo pendiente de aval y lectura vigente del mensaje editado. |
| `demo.nicolas` | Bombero con permiso TECHNICAL; ERA, presencia sintetica y solicitud de correccion de salida pendiente. |
| `demo.camila` | Bombera con ausencia vigente, licencia vencida, propuesta de transferencia recibida y reintegros pagado/revertido. |
| `demo.aspirante` | Aspirante mayor: permisos operativos de usuario y un trabajo remoto avalado por suboficial. |
| `demo.guardia` | Guardia dedicado: QR, avisos, seguimiento y actas dentro de sus permisos; no equivale al administrador general. |
| `demo.suboficial` | Segundo suboficial independiente: completar el segundo aval del gasto de oficial. |
| `demo.lucia` | Bombera con permiso PPE; gestion de prendas institucionales, presencia sintetica y planilla de emergencia abierta. |
| `demo.mateo` | Bombero con funcion adicional de guardia; tareas rechazadas/retomadas para probar penalizaciones y entrega de casco pendiente. |
| `demo.directiva` | Comision directiva con permiso FINANCE, sin acceso general de administrador. |
| `demo.menor` | Aspirante menor: verificar las restricciones por cargo y edad. |
| `demo.clave_inicial` | Cuenta que exige cambiar la clave inicial. |
| `demo.inactivo` | Cuenta pausada: el ingreso debe rechazarse. |
| `demo.pendiente` | Cuenta pendiente de aprobacion: no debe ingresar como personal activo. |

Los permisos delegados se crean una sola vez. Si se revocan al probar, volver a ejecutar el seed no los concede otra vez.

## Recorridos recomendados

### 1. Usuario operativo y privacidad

Ingresar con `demo.bombero`. Revisar perfil, licencias y prendas; contrastar prendas declaradas con una solicitud institucional. Visitar tareas, comunicaciones y gastos propios. El ranking, los datos privados de otros integrantes y la auditoria administrativa no deben aparecer.

Luego ingresar con `demo.admin`: debe tener administracion general, pero no tratarse como un integrante operativo que ficha o confirma lectura.

### 2. Gastos, autorizaciones y saldos

En administracion financiera buscar los siguientes titulos. Los importes internos se guardan en centavos.

| Escenario | Titular | Importe ARS | Resultado esperado |
| --- | --- | ---: | --- |
| Compra pendiente de revision | Bombero | 1.200 | Espera decision; no registrar como pagado. |
| Insumos aprobados sin pagar | Bombero | 1.300 | Deuda autorizada, saldo 1.300. |
| Reintegro parcialmente pagado | Bombero | 1.400 | Pago vigente 500; saldo 900. |
| Comprobante rechazado | Bombero | 1.500 | Rechazado; no puede pagarse como aprobado. |
| Gasto de oficial: falta segundo aval | Oficial | 1.600 | Operador ya avalo; `demo.suboficial` puede completar el segundo aval independiente. |
| Gasto de oficial: dos avales | Oficial | 1.700 | Dos suboficiales distintos; aprobado sin pago. |
| Reintegro pagado por completo: saldo cero | Camila | 2.450 | Saldo cero; no duplicar el pago. |
| Reintegro con pago revertido: deuda reabierta | Camila | 2.950 | Conservar la constancia revertida y mostrar saldo 2.950. |

Cada caso tiene una imagen JPEG local marcada SIMULACRO / SIN VALIDEZ FISCAL y un hash diferente. Solo el titular y los revisores autorizados pueden consultarla. El seed no emite transferencias bancarias.

### 3. Tareas y ranking

- `Revisar extintores del salon`: propuesta pendiente de Bombero hacia Camila. Hasta que Camila acepte, Bombero sigue a cargo. Es presencial: aceptar requiere QR vigente.
- `Transferencia aceptada por Camila`: caso remoto ya transferido; Camila es responsable y Bombero ya no integra el equipo.
- `Transferencia rechazada` y `Transferencia cancelada`: Bombero conserva la responsabilidad.
- `Tarea retomada: conserva penalizacion anterior`: Mateo volvio a tomarla, pero su evento No puedo sigue registrado para calcular la penalizacion.
- `Trabajo remoto avalado por suboficial`: Aspirante lo completo y Operador lo avalo. No exige QR ni autoaval.
- Otros casos cubren tarea abierta, tomada, vencida, presentada, devuelta, verificada, cancelada y mantenimiento publicado como tarea.
- Hay plantillas de sorteo activas y una inactiva; la inactiva no debe seleccionarse. La politica inicial usa los valores predeterminados del sistema y no pisa ajustes posteriores.
- Solo administrador/oficial puede ver el ranking. Las horas pagadas de guardia no se convierten en puntaje por presencia.

### 4. Comunicaciones y versiones

Buscar `Cambio de horario: practica el viernes a las 19:00`.

- Bombero confirmo la version vieja (18:00): su acuse se conserva como evidencia pero no confirma el texto actual.
- Sofia confirmo la version actual (19:00).
- El autor es Oficial. Probar permisos de edicion y confirmacion con distintas cuentas.

### 5. Guardias y presencia

El calendario incluye dias y noches, historial, turnos futuros y relevos. No se asignan integrantes durante ausencias programadas. Hay intercambios pendiente, aceptado a la espera de jefatura y rechazado.

Nicolas tiene una solicitud de cierre de fichaje ajeno pendiente; el solicitante es Guardia y la decision debe ser independiente. Hay ademas apertura manual aprobada y solicitud rechazada, ambas trazables.

La permanencia de Sofia descartada por vencimiento tiene cero minutos. Los ingresos QR nuevos del seed referencian un desafio valido al momento de ingreso, ya vencido/revocado hoy: no se precargan tokens reutilizables.

Las presencias abiertas son una fotografia temporal, no se renuevan artificialmente. Pueden vencer al iniciar el backend segun las reglas del sistema. Para probar desde cero, generar un QR con Guardia/Admin, escanear con el usuario y utilizar una ubicacion de prueba admitida; el seed no desactiva la geocerca.

### 6. Emergencia completa, controles y evidencias

Buscar en Intervenciones los siguientes titulos:

| Planilla completa | Autor | Estado |
| --- | --- | --- |
| Incendio de vivienda - planilla completa | `demo.admin` | Cerrada, alerta resuelta, contexto de cierre conservado. |
| Rescate en altura - planilla completa | `demo.oficial` | Cerrada, alerta resuelta, contexto de cierre conservado. |
| Accidente vehicular - planilla completa | `demo.subjefe` | Cerrada, alerta resuelta, contexto de cierre conservado. |
| Servicio completo pendiente de cierre | `demo.oficial` | Completa y editable; movil retornado, lista para practicar el cierre. |

Cada una enlaza aviso telefonico, alerta, quien despacho, quien llamo y su telefono, ubicacion, tipo, actuacion, dotacion Bombero/Sofia, conductor Bombero, responsable Sofia, movil, salida/llegada/retorno, Lucia en base con prueba QR historica y materiales contabilizados. Las cerradas tienen participaciones verificadas y auditoria. No se fabricaron fotografias de emergencias ni enlaces de evidencia inexistentes: el campo opcional de evidencia queda vacio.

Los autores no reciben asistencia ni puntos por redactar. Oficial mantiene su respuesta No voy. Administrador y oficial pueden guardar la planilla abierta sin QR; cualquier cuenta activa puede consultarla, mientras que los demas necesitan QR vigente para editar. Las cerradas admiten anexos/enmiendas segun permisos, sin sobrescribir el original.

Son servicios historicos de entrenamiento (anteriores a los otros escenarios) para no duplicar salidas simultaneas ni personal fuera del cuartel. Las cuatro planillas se crean atomicamente y repetir el seed no restaura sus datos si se modificaron durante las pruebas.

Hay avisos pendientes, corregidos, anulados y convertidos en alertas; intervenciones abiertas/cerradas, una anulada con reemplazo y una salida activa. La emergencia de vivienda incluye aviso, convocatoria, movil, conductor, dotacion y planilla abierta con datos precargados.

Los controles incluyen faltantes, cantidades parciales, material en otro lugar, danos y un control completamente firmado con asistencia QR historica. Las fallas tienen tareas de mantenimiento asociadas. No usar estos registros como certificacion de moviles reales.

Hay anexos posteriores de novedad, terceros, correccion y rotura: no deben reabrir ni reemplazar el cierre original.

### 7. Otros modulos

Probar cursos pendiente/aprobado/rechazado; licencias vigentes, cambiadas y vencidas; solicitudes de prendas en distintos estados; ERA vigente/vencido/rechazado/vacio/retirado; viajes de agua con remuneracion pendiente/aprobada; cargas decimales de combustible y registros anulados. No todos los registros historicos tienen aval financiero: no deben convertirse automaticamente en deuda autorizada.

## Repeticion segura y escenarios nuevos

Repetir el comando agrega lo que falta sin deshacer decisiones: no reabre fichajes, no repone asignaciones ya modificadas, no cambia montos ni decisiones de pago y no renueva plazos artificialmente. Los casos se anclan al primer reloj del esquema.

Los votos, tareas y otras relaciones creadas desde la aplicacion por las cuentas demo pueden tener identificadores automaticos sin prefijo. El control verifica su pertenencia mediante todas sus relaciones; no los confunde con datos ajenos ni los elimina. Los eventos automaticos de ausencia se admiten solo para turnos y usuarios demo. Raices ajenas o relaciones cuya pertenencia no puede comprobarse siguen bloqueando el seed.

Para obtener otro conjunto fresco SIN borrar el anterior:

```powershell
$env:SEED_SCHEMA='bomberos_demo_prueba_nueva'
npm run seed:demo
Remove-Item Env:SEED_SCHEMA
```

Para navegar ese conjunto, apuntar el backend al nuevo esquema y reiniciarlo. Esto es opcional: no hace falta cambiar de esquema para agregar los escenarios nuevos al demo habitual. Las correcciones a datos antiguos preservados solo se garantizan en una carga limpia; el seed no reescribe su historial silenciosamente.

## Verificacion automatica

```powershell
npm run seed:verify
```

Crea un esquema temporal y lo elimina al terminar, tambien ante un error. Comprueba relaciones, cronologia, cargos, acuses de distintas versiones, fotos y hashes, saldos, independencia de avales, transferencias, ausencias y QR. Repite el seed y el lanzador para verificar idempotencia, conserva cambios de nombre/estado/clave/notas y rechaza esquemas no demo o bases mixtas. Tambien comprueba por HTTP el ingreso y cierre de sesion de las nueve cuentas principales.

No activa envios push, no precarga sesiones autenticadas ni dispositivos confiables. Esta verificacion prueba los datos de ejemplo; no sustituye las suites HTTP completas ni certifica como terminadas todas las reglas institucionales pendientes.
