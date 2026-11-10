> Este backend está separado del frontend. Consultar primero el README de la raíz para configurar FRONTEND_DIR y el directorio de estado externo.

# Backend local de gestión de proyectos

Esta etapa es una API de desarrollo, no un despliegue de producción. La aplicación original en el puerto 8090 sigue usando su almacenamiento del navegador. La interfaz conectada se sirve desde el mismo origen que la API y requiere iniciar sesión. No se migran datos ni se cambian los permisos de los registros originales. Los controles descritos aquí se aplican a los endpoints del backend.

## Ejecutar

Requiere Node.js 24 o superior. No requiere instalar paquetes para SQLite.

```powershell
node --test scripts/test-backend.mjs
node server/start.mjs
```

La interfaz conectada y la API escuchan exclusivamente en `http://127.0.0.1:8091`. La aplicación original continúa separada en el puerto 8090. El endpoint `/health` comprueba disponibilidad. No se habilita CORS entre ambos servidores: las solicitudes de la interfaz conectada usan el mismo origen. El backend rechaza `NODE_ENV=production` hasta completar las decisiones de TI.

La base SQLite se crea fuera del repositorio, en `BACKEND_STATE_DIR/development/development.sqlite` respecto de la raíz de la aplicación. No se agregan cuentas, contraseñas, proyectos ni documentos de ejemplo. Las pruebas usan bases en memoria y una carpeta temporal del sistema que se limpia al finalizar.

## Primer administrador

### Demostración conectada con cuentas ficticias

Para probar sin importar ni modificar los registros existentes:

```powershell
node server/demo.mjs
```

Abrir `http://127.0.0.1:8092/`. Esta instancia usa exclusivamente `BACKEND_STATE_DIR/demo/demo.sqlite`, fuera del repositorio. Genera tres cuentas de prueba (administrador, responsable y consulta) con contraseñas aleatorias. Los accesos se entregan en `BACKEND_STATE_DIR/demo/Cuentas-de-prueba.md`, también fuera del repositorio. No copiar ese archivo a Git ni reutilizar las claves. Al reiniciar se conservan las cuentas y los cambios de la demostración; no se vuelve a sembrar una base existente.

La interfaz conectada usa cookies de sesión y CSRF con la API en el mismo origen. No guarda una copia de los proyectos en localStorage ni IndexedDB. Abrir varias pestañas del mismo navegador comparte la sesión: cerrar sesión antes de probar otro perfil. Para sesiones simultáneas independientes usar perfiles de navegador separados.

Se pueden probar proyectos, tareas, edición de estado y responsable, solicitudes de creación y eliminación, aprobación/rechazo, usuarios y perfiles, consulta de auditoría, registro de gastos, conclusión, actividades de cronograma y PDF general basado en el snapshot del servidor. El móvil limita a tres tareas por proyecto en la vista general de tareas y permite abrir el detalle completo.

Los editores conectados de comparativos, versiones de cronograma, papelera y biblioteca de documentos aún requieren ampliación. La subida de adjuntos no está disponible en esta instancia. La interfaz original conserva sus funciones y almacenamiento separados en el puerto 8090. La demostración está limitada a loopback, no permite `DATABASE_URL` ni modo producción y no implica despliegue, acceso desde otros equipos o instalación como PWA.

Pruebas adicionales de recursos públicos, aislamiento y persistencia: `node --test scripts/test-connected.mjs`.

### Instalación sin datos de ejemplo

Un operador debe proporcionar `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME` y `BOOTSTRAP_PASSWORD` mediante variables de entorno locales y ejecutar `node server/bootstrap.mjs`. No introducir contraseñas en argumentos, URLs, archivos del proyecto ni commits. El bootstrap funciona únicamente cuando no hay usuarios. Borrar las variables del proceso del operador al terminar. No se creó una cuenta real durante la implementación.

El login local con contraseña es provisional para desarrollo. La integración corporativa, MFA, recuperación de cuenta e invitaciones quedan pendientes de la decisión de TI. No existe registro público ni envío de correo. Solo un administrador autenticado puede crear cuentas o restablecer contraseñas mediante la API.

## Roles y reglas

| Identificador | Perfil | Alcance |
| --- | --- | --- |
| `admin` | Administrador | Usuarios, permisos, todos los proyectos, tareas, revisión de solicitudes y auditoría |
| `responsable` | Responsable de proyectos | Lee y edita todos los proyectos activos y sus tareas, cronograma y costos; solicita crear o eliminar proyectos |
| `consulta` | Gerencia / Consultor | Lee todos los proyectos activos, tareas, cronogramas, costos y datos de cierre; sin modificaciones de negocio |

La creación o eliminación solicitada por un responsable necesita aprobación de un administrador. El administrador también puede crear o archivar directamente. Aprobar dos veces una solicitud devuelve 409. Si cambia el proyecto o sus tareas/costos/cronograma después de pedir la eliminación, la aprobación falla y la solicitud conserva su estado pendiente: corresponde rechazarla y solicitarla nuevamente. La aprobación elimina el proyecto de la vista activa mediante `archived_at`; conserva tareas, registros y eventos. Un administrador puede restaurarlo con su versión actual. Las tareas se archivan lógicamente, sin borrado físico.

No hay flujo de aprobación de gastos. El estado `approved` de una cotización conserva el significado existente de oferta seleccionada para calcular el presupuesto; no representa una autorización de pago. No se expone un endpoint de aprobar gastos.

## API

Todos los cuerpos son objetos JSON, máximo 256 KiB. Las respuestas llevan `Cache-Control: no-store`. Los campos no permitidos se rechazan. Las versiones de filas son enteros; una actualización con versión anterior devuelve 409 y no pisa datos.

| Método y ruta | Uso |
| --- | --- |
| `POST /api/login` | `{email,password}`; establece cookie de sesión y devuelve `csrf_token` |
| `GET /api/me` | Identidad actual y token CSRF para recuperar una sesión tras recargar |
| `POST /api/logout` | Revoca la sesión actual |
| `GET /api/directory` | IDs y nombres de usuarios activos para asignar tareas |
| `GET, POST /api/users` | Administrador: listar o crear `{email,name,role,password}` |
| `PATCH /api/users/:id` | Administrador: `{version,name?,role?,active?,password?}`; revoca las sesiones del afectado |
| `GET, POST /api/projects` | Listar; crear directamente solo como administrador |
| `GET, PATCH, DELETE /api/projects/:id` | Consultar, editar con `version`, archivar con `{version,reason}` solo administrador |
| `POST /api/projects/:id/restore` | Administrador: `{version,reason}`; restaura un proyecto archivado |
| `GET, POST /api/projects/:id/tasks` | Listar o crear tareas |
| `PATCH, DELETE /api/tasks/:id` | Editar con `version` o archivar con `{version}` |
| `GET, PUT /api/projects/:id/schedule` | Cronograma; guardar `{version,payload}` |
| `GET, PUT /api/projects/:id/costs` | Costos; guardar `{version,payload}` |
| `GET /api/projects/:id/closure` | Snapshot de cierre si hay tareas y todas están completadas |
| `GET, POST /api/requests` | Administrador ve todas; responsable ve sus solicitudes y puede crear nuevas |
| `POST /api/requests/:id/approve` | Solo administrador; `{note?}` |
| `POST /api/requests/:id/reject` | Solo administrador; `{note?}` |
| `GET /api/audit` | Administrador: últimos 200 eventos |

Crear proyecto: `{name,description?,due_date?}`. Tareas: `{name,description?,status?,priority?,owner_id?,due_date?}`. Los campos usan nombres con guion bajo y fechas ISO `AAAA-MM-DD`. `owner_id` identifica un usuario activo; no es un nombre libre. Un adaptador de frontend deberá mapear el formato actual sin modificar ni perder el original.

Solicitar creación: `{kind:"create",project:{name,description?,due_date?},reason}`. Solicitar eliminación: `{kind:"delete",project_id,reason}`. Los parámetros escritos con `?` en este documento son opcionales, no parte del nombre JSON.

En cronograma/costos, el primer `PUT` usa versión 0; los siguientes deben usar la versión recibida. El payload admite los campos validados en `validateRecord` de `service.mjs`, compatibles con el contenido principal de los módulos existentes. Historial completo de versiones del cronograma y archivos adjuntos requieren endpoints adicionales antes de conectar o migrar el frontend.

## Seguridad implementada y límites

- Contraseñas con scrypt, sal aleatoria, comparación de tiempo constante y mínimo 14 caracteres. No se almacenan contraseñas en claro.
- Sesiones opacas aleatorias, solo hash persistido; expiración absoluta de ocho horas. Desactivación, cambio de perfil o contraseña revocan las sesiones del usuario. Se impide quitar el último administrador activo.
- Cookie HttpOnly, SameSite=Strict y token CSRF obligatorio en operaciones que modifican datos. Validación de Host y Origin; sin acceso cruzado a la API. `Secure` no se activa en HTTP loopback; es obligatorio configurar HTTPS y cookies Secure antes de producción.
- Límite de intentos de login por IP y cuenta, solo en memoria. En producción debe trasladarse al servicio de identidad o almacenamiento compartido. No sustituye protección de red ni monitoreo.
- Consultas parametrizadas, transacciones para operación y auditoría, comprobación de rol en servidor, asignación explícita de campos y control de versiones. Errores internos no devuelven SQL ni credenciales.
- Auditoría registra actor, acción, entidad, hora del servidor y metadatos acotados; no contraseñas ni tokens. Es un registro de aplicación, no una bitácora inmutable ni una copia de seguridad. Un administrador de base de datos puede alterarlo.
- Los registros de costos y cronograma se almacenan como JSON validado, con control de versión. Antes de informes financieros avanzados o integración contable, evaluar normalizarlos en tablas de detalle.

## PostgreSQL y TI

`database.mjs` separa el acceso a datos. Si se establece `DATABASE_URL`, carga el driver `pg` y aplica migraciones versionadas compatibles de `migrations/001-initial.sql`. El driver no se instaló ni se ejecutó contra PostgreSQL en esta PC. Instalarlo con el gestor autorizado, fijar su versión y generar lockfile antes de usar esa opción. No desactivar la validación TLS; TI debe proveer la configuración y CA correspondientes. La base SQLite local no se copia automáticamente a PostgreSQL.

Antes de producción faltan: probar esquema, migraciones y concurrencia en PostgreSQL real; integrar identidad corporativa; configurar HTTPS/cookies Secure/proxy; implementar almacenamiento privado de archivos, escaneo de cargas y límites; definir respaldos de base y adjuntos y ensayar su restauración; retención, monitoreo y alertas; límites de peticiones distribuidos y pruebas de seguridad; completar los editores conectados de documentos, comparativos y versiones del cronograma, y hacer una migración explícita con verificación y posibilidad de reversión. No se ofrece todavía un endpoint para subir documentos ni se transfieren archivos del navegador.

No ejecutar despliegues ni subir código automáticamente. Ninguna credencial, base local, respaldo o archivo de negocio debe entrar en Git.
