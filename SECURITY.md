# Alcance y seguridad de la sincronizacion

- Solo codigo de la aplicacion y herramientas de desarrollo. Nunca perfiles del navegador, bases locales, registros reales, documentos corporativos, facturas, contratos, claves, certificados o exportaciones.
- Repositorio privado con acceso minimo. La privacidad y las cuentas autorizadas deben comprobarse en el servicio. No dar acceso a terceros sin aprobacion.
- `.gitignore` previene inclusiones accidentales; no borra datos ya presentes en el historial y no garantiza detectar todos los secretos. `npm run check` es una revision preventiva limitada.
- Revisar `git diff --cached` antes de cada commit y los commits antes de subir. Si aparece un secreto, detener la subida y avisar al responsable. No reescribir ni borrar historia sin autorizacion.
- Git no sincroniza informacion almacenada por FORJA en el navegador ni crea copias de seguridad de documentos. Conservar respaldos independientes de esa informacion.
- No hay sincronizacion en segundo plano ni push automatico. El usuario decide cuando subir; el comando de subida exige confirmacion explicita. No hay workflow que publique el sitio.
- Este servidor local escucha solo en 127.0.0.1. No esta preparado para servir una aplicacion corporativa en produccion.

