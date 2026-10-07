# Control de parqueaderos

App web y móvil para portería. El administrador y el master cargan permisos. La portería busca la placa, valida los datos y registra ingreso o salida.

Hora oficial: America/Bogota.

Permiso de ejemplo: SOL-88881, placa EMP107, José Luis Vargas Gallego, cédula 80.727.409, 8 de octubre de 2026 de 07:00 a 13:00.

Usuario inicial: `admin`  
Clave inicial: `Admin2026!`  
Cámbiala al entrar.

## Autoregistro

En el ingreso está Crear cuenta. La cuenta queda como usuario general y no puede entrar hasta que un master o el administrador la autorice en Usuarios.

## Base de datos

Upstash Redis en Vercel. En local se usa `data/db.json`, que no se sube a GitHub.

## Probar en local

```bash
node server.js
```

Abre http://localhost:8080. En el celular de la misma red: http://IP-DEL-COMPUTADOR:8080.

La cámara no funciona si abres el HTML con doble clic.

## Subir a GitHub

1. Crea un repositorio vacío en https://github.com llamado `control-parqueaderos`. No marques README ni licencia.
2. Dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Control de parqueaderos"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/control-parqueaderos.git
git push -u origin main
```

Si pide clave, usa un token personal de GitHub. No subas `data/db.json`: está en `.gitignore`.

## Subir a Vercel

1. Importa el repositorio en https://vercel.com. Framework Preset: Other.
2. Crea Redis gratis en https://console.upstash.com.
3. En Vercel, Settings, Environment Variables, agrega `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
4. Redeploy.

Sin esas dos variables la app abre, pero los datos nuevos pueden perderse entre visitas.

## Cámara

- QR: lectura exacta si el código contiene la placa.
- Placa: foto con la cámara trasera y comparación con el listado autorizado.
