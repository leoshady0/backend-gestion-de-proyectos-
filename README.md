# Gestión de proyectos - backend

API de desarrollo con Node.js 24+, SQLite local y adaptador PostgreSQL. Contiene usuarios, sesiones, los tres roles acordados, proyectos, tareas, solicitudes de creación y eliminación, cronogramas, costos, snapshots de cierre y auditoría. No incluye el frontend: se mantiene en su propio repositorio.

## Preparar dos repositorios

Clonar los repositorios en carpetas hermanas llamadas frontend y backend. El backend busca por defecto frontend/dist. Para otra ubicación, definir FRONTEND_DIR con su ruta absoluta. No se instala ninguna dependencia para usar SQLite.

```powershell
node scripts/check.mjs
node --test scripts/test-backend.mjs
node --test scripts/test-connected.mjs
node server/demo.mjs
```

La prueba de integración requiere el checkout del frontend. Las pruebas unitarias y HTTP del backend no lo requieren.

## Demostración conectada

Abrir http://127.0.0.1:8092/. La primera ejecución genera tres cuentas ficticias con claves aleatorias y proyectos de muestra. Se guardan en el directorio de estado externo a ambos repositorios; no vienen incluidas en Git. Reiniciar conserva los datos y cuentas de prueba. El archivo Cuentas-de-prueba.md se escribe en el subdirectorio demo del directorio de estado. Cerrar sesión antes de cambiar de perfil; las pestañas del mismo navegador comparten sesión.

## Directorio de estado y variables

BACKEND_STATE_DIR permite elegir una carpeta privada fuera de los repositorios. Por defecto se utiliza una carpeta hermana llamada .gestion-proyectos-local, con subdirectorios development y demo. No sincronizar esta carpeta con Git. FRONTEND_DIR debe apuntar a frontend/dist.

Para iniciar una base vacía sin ejemplos: node server/start.mjs (puerto 8091). Si no encuentra el frontend, arranca solo la API. Crear el primer administrador con node server/bootstrap.mjs usando BOOTSTRAP_EMAIL, BOOTSTRAP_NAME y BOOTSTRAP_PASSWORD locales y retirando las variables al terminar. El bootstrap solo funciona si no hay usuarios; no hay registro público. No escribir contraseñas en comandos, URLs ni archivos del repositorio.

## Perfiles

- admin: usuarios, permisos, proyectos, tareas, solicitudes y auditoría.
- responsable: gestiona todos los proyectos activos y sus tareas; crear o eliminar proyectos requiere aprobación de un administrador.
- consulta: Gerencia / Consultor; lectura de proyectos, tareas, cronogramas y costos.

La eliminación archiva los registros. Un administrador puede restaurar proyectos. Cambios de estado, rol o contraseña revocan sesiones. Las modificaciones requieren CSRF y versión actual; los conflictos devuelven 409. No existe aprobación de gastos.

## PostgreSQL y estado de desarrollo

DATABASE_URL selecciona PostgreSQL en el arranque normal. Requiere instalar y fijar el driver pg con el gestor aprobado por TI y validar TLS. No se instaló ese driver ni se probó contra PostgreSQL real en esta etapa. Las migraciones SQL están en server/migrations. La demostración rechaza DATABASE_URL y NODE_ENV=production. Los comandos normales también rechazan producción hasta completar identidad corporativa, HTTPS y operación.

El cronograma registra cada guardado y conserva el contenido de las últimas 15 versiones para exportación. Solo un administrador puede editar el presupuesto aprobado. Los administradores y responsables pueden adjuntar comprobantes PDF o Excel a gastos existentes. Los comprobantes se guardan con el gasto en la base de datos y se descargan con sesión iniciada.

Pendientes: identidad corporativa/MFA, escaneo de archivos para producción, respaldos y restauración ensayada, monitoreo, PostgreSQL real y migración explícita de datos. El frontend original conserva sus datos en su propio navegador; esta API no los importa ni borra.

Más detalles de endpoints y controles en server/README.md. Solo se guarda código: no bases, credenciales, sesiones, accesos de prueba, adjuntos ni datos reales. No desplegar ni subir cambios sin autorización.
