# Givox - Estado del Proyecto

## Descripción General
Givox es una plataforma de donaciones para streamers con sistema de regalos en video (webm), tienda de monedas virtuales y sistema de canjes. El proyecto consiste en un backend Node.js con Express, Supabase como base de datos, y un dashboard frontend para administración.

---

## Estructura de Archivos

```
givox-app/
├── backend/
│   ├── .env                      # Variables de entorno (SUPABASE_URL, SUPABASE_KEY, PORT)
│   ├── .env.example              # Plantilla de variables de entorno
│   ├── package.json              # Dependencias del proyecto
│   ├── schema.sql                # Esquema base de base de datos (users, gifts, donations)
│   ├── server.js                 # Servidor principal Node.js/Express
│   ├── supabase.js               # Cliente de Supabase
│   ├── migrations/
│   │   └── shop_tables.sql       # Migración para tablas de tienda de monedas
│   ├── public/
│   │   ├── dashboard.html        # Dashboard de administración
│   │   └── overlay.html          # Overlay para streamers
│   └── node_modules/             # Dependencias instaladas
└── PROJECT_STATUS.md             # Este archivo
```

---

## Base de Datos (Supabase)

### Tablas Principales

#### 1. `users`
- **id**: UUID (primary key)
- **username**: TEXT (unique) - Nombre de usuario
- **display_name**: TEXT - Nombre mostrado
- **role**: ENUM ('espectador', 'streamer') - Rol del usuario
- **created_at**: TIMESTAMPTZ - Fecha de creación

#### 2. `gifts`
- **id**: UUID (primary key)
- **name**: TEXT (unique) - Nombre del regalo
- **video_url**: TEXT - URL del video .webm
- **created_at**: TIMESTAMPTZ - Fecha de creación
- **Constraint**: gifts_video_url_webm - Valida que la URL termine en .webm

#### 3. `donations`
- **id**: UUID (primary key)
- **donor_id**: UUID (FK → users) - ID del donante
- **streamer_id**: UUID (FK → users) - ID del streamer
- **gift_id**: UUID (FK → gifts) - ID del regalo
- **sent_at**: TIMESTAMPTZ - Fecha de envío
- **Constraint**: donations_distinct_users - Valida que donante ≠ streamer

**Índices**: donor_id, streamer_id, gift_id, sent_at (desc)

#### 4. `coins` (Tienda de Monedas)
- **id**: UUID (primary key)
- **user_id**: UUID (FK → users, ON DELETE CASCADE) - ID del usuario
- **balance**: INTEGER - Saldo de monedas (default: 0)
- **updated_at**: TIMESTAMPTZ - Última actualización
- **Unique**: user_id

**Índices**: user_id

#### 5. `shop_items` (Catálogo de Tienda)
- **id**: UUID (primary key)
- **name**: TEXT - Nombre del item
- **description**: TEXT - Descripción del item
- **cost**: INTEGER - Costo en monedas
- **image_url**: TEXT - URL de imagen (opcional)
- **is_active**: BOOLEAN - Estado activo (default: true)
- **created_at**: TIMESTAMPTZ - Fecha de creación

#### 6. `coin_purchases` (Registro de Compras)
- **id**: UUID (primary key)
- **user_id**: UUID (FK → users, ON DELETE CASCADE) - ID del usuario
- **amount**: INTEGER - Cantidad de monedas compradas
- **payment_method**: TEXT - Método de pago (opcional)
- **transaction_id**: TEXT - ID de transacción (opcional)
- **created_at**: TIMESTAMPTZ - Fecha de compra

**Índices**: user_id

#### 7. `redemptions` (Historial de Canjes)
- **id**: UUID (primary key)
- **user_id**: UUID (FK → users, ON DELETE CASCADE) - ID del usuario
- **item_id**: UUID (FK → shop_items, ON DELETE CASCADE) - ID del item canjeado
- **coins_spent**: INTEGER - Monedas gastadas
- **created_at**: TIMESTAMPTZ - Fecha de canje

**Índices**: user_id, item_id

---

## Servidor Node.js (server.js)

### Dependencias
- **express**: ^5.3.0 - Framework web
- **cors**: ^2.8.6 - Habilita CORS
- **socket.io**: ^4.8.4 - WebSockets para tiempo real
- **@supabase/supabase-js**: ^2.117.3 - Cliente de Supabase
- **dotenv**: ^18.0.7 - Carga variables de entorno

### Configuración
- **Puerto**: 3000 (configurable via env PORT)
- **Streamer por defecto**: "streamer" (configurable via env STREAMER_USERNAME)
- **Socket.io**: Habilitado con CORS para todos los orígenes

### Funciones Auxiliares

#### `getOrCreateUser(username, role)`
Busca un usuario por username. Si no existe, lo crea con el rol especificado.
- Maneja colisiones concurrentes (error 23505)
- Retorna: `{ id, username, role }`

#### `getOrCreateGift(name, videoUrl)`
Busca un regalo por nombre. Si no existe, lo crea con la URL de video.
- Maneja colisiones concurrentes (error 23505)
- Retorna: `{ id, name, video_url }`

---

## Endpoints API

### Donaciones

#### POST `/api/donar`
Envía una donación con alerta de regalo.

**Body:**
```json
{
  "donorName": "string",
  "giftName": "string",
  "videoUrl": "string",
  "streamerName": "string (opcional)"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "donationId": "uuid",
  "sentAt": "timestamp"
}
```

**Validaciones:**
- donorName, giftName, videoUrl son obligatorios
- Donante y streamer no pueden ser la misma persona
- Emite evento Socket.io "nueva-alerta" con los datos del regalo

---

### Sistema de Monedas

#### GET `/api/coins/balance`
Obtiene el balance de monedas de un usuario.

**Query params:**
- `username`: string (obligatorio)

**Respuesta:**
```json
{
  "ok": true,
  "balance": 0,
  "updated_at": "timestamp | null"
}
```

**Comportamiento:**
- Crea automáticamente el usuario si no existe (rol: espectador)
- Retorna 0 si el usuario no tiene registro de monedas

---

#### POST `/api/coins/purchase`
Compra monedas para un usuario.

**Body:**
```json
{
  "username": "string",
  "amount": "number (> 0)",
  "paymentMethod": "string (opcional)",
  "transactionId": "string (opcional)"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "newBalance": 0,
  "amountAdded": 0
}
```

**Comportamiento:**
- Crea automáticamente el usuario si no existe (rol: espectador)
- Crea registro en tabla `coins` si no existe
- Actualiza balance existente si ya tiene monedas
- Registra la compra en `coin_purchases`

---

### Tienda de Items

#### GET `/api/shop/items`
Obtiene el catálogo de items disponibles.

**Respuesta:**
```json
{
  "ok": true,
  "items": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string",
      "cost": 0,
      "image_url": "string | null"
    }
  ]
}
```

**Comportamiento:**
- Solo retorna items con `is_active = true`
- Ordenados por costo ascendente

---

#### POST `/api/shop/redeem`
Canjea un item del catálogo.

**Body:**
```json
{
  "username": "string",
  "itemId": "uuid"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "itemName": "string",
  "coinsSpent": 0,
  "newBalance": 0
}
```

**Validaciones:**
- Crea automáticamente el usuario si no existe (rol: espectador)
- Verifica que el item existe y está activo
- Verifica saldo suficiente
- Descuenta monedas del balance
- Registra el canje en `redemptions`

---

### Historial de Canjes

#### GET `/api/redemptions/history`
Obtiene el historial de canjes de un usuario.

**Query params:**
- `username`: string (obligatorio)

**Respuesta:**
```json
{
  "ok": true,
  "redemptions": [
    {
      "itemName": "string",
      "coinsSpent": 0,
      "createdAt": "timestamp"
    }
  ]
}
```

**Comportamiento:**
- Retorna array vacío si el usuario no existe
- Hace join con `shop_items` para obtener el nombre del item
- Últimos 20 canjes ordenados por fecha descendente
- Formatea el nombre del item como "Item desconocido" si no se encuentra

---

## Frontend (dashboard.html)

### Secciones

#### 1. Formulario de Donaciones
- Campo: Nombre del donante
- Campo: Nombre del regalo
- Campo: URL del video (.webm)
- Presets de regalos de prueba (Rose, Lion, Universe)
- Botón: Enviar Donación
- Notificaciones de estado (éxito/error)

#### 2. Tienda de Monedas
- **Display de Saldo**: Muestra el balance actual del usuario
- **Botón Actualizar**: Recarga el balance
- **Formulario de Recarga**:
  - Input: Cantidad de monedas a comprar
  - Botón: Comprar Monedas

#### 3. Catálogo de Tienda
- Grid de items disponibles
- Cada item muestra:
  - Nombre
  - Descripción
  - Costo en monedas
  - Botón: Canjear
- Ordenado por costo

#### 4. Historial de Canjes
- Tabla con columnas:
  - Item
  - Costo (en dorado)
  - Fecha (formateada en español)
- Estados vacíos:
  - "Ingresa un nombre de usuario para ver el historial"
  - "No hay canjes registrados"
  - "Error cargando historial"

### Funciones JavaScript

#### `loadBalance()`
Obtiene el balance del usuario actual vía `/api/coins/balance`.

#### `loadShopItems()`
Carga el catálogo de items vía `/api/shop/items`.

#### `buyCoins()`
Procesa la compra de monedas vía `/api/coins/purchase`.

#### `redeemItem(itemId, cost, itemName)`
Canjea un item específico vía `/api/shop/redeem`.
- Muestra confirmación antes de canjear
- Actualiza balance y historial después del canje

#### `loadRedemptionHistory()`
Carga el historial de canjes vía `/api/redemptions/history`.
- Formatea fechas en formato español (DD/MM/YYYY HH:MM)
- Maneja estados vacíos y errores

### Eventos

#### Cambio de Nombre de Usuario
Al cambiar el campo "Nombre del donante":
- Actualiza `currentUsername`
- Recarga el balance
- Recarga el historial de canjes

#### Inicialización
Al cargar la página:
- Carga el catálogo de items
- Carga el historial de canjes (si hay usuario)

---

## Configuración de Entorno

### Archivo `.env`
```env
SUPABASE_URL=https://lnmyzoejjdbkujecznnt.supabase.co
SUPABASE_KEY=sb_secret_YOUR_SECRET_KEY_HERE
PORT=3000
```

### Variables
- **SUPABASE_URL**: URL del proyecto Supabase
- **SUPABASE_KEY**: Secret key de Supabase (acceso completo)
- **PORT**: Puerto del servidor (default: 3000)
- **STREAMER_USERNAME**: Nombre del streamer por defecto (default: "streamer")

---

## Rutas Estáticas

- `GET /` → `overlay.html` (Overlay principal)
- `GET /overlay.html` → `overlay.html`
- `GET /dashboard` → `public/dashboard.html` (Dashboard de administración)
- Archivos estáticos desde `backend/public/`

---

## Socket.io

### Eventos Emitidos
- **nueva-alerta**: Se emite cuando se crea una donación
  - Datos: `{ donorName, giftName, videoUrl }`

### Conexión
- Habilitado en puerto 3000
- CORS permitido para todos los orígenes
- Logs de conexión/desconexión en consola

---

## Notas de Implementación

### Auto-creación de Usuarios
Los endpoints de monedas (`/api/coins/balance`, `/api/coins/purchase`, `/api/shop/redeem`) crean automáticamente usuarios si no existen con rol "espectador". Esto permite que usuarios nuevos interactúen con el sistema sin registro previo.

### Manejo de Errores
- Todos los endpoints retornan JSON con formato `{ ok: boolean, error?: string }`
- Errores de validación: HTTP 400
- Errores de servidor: HTTP 500
- Errores de base de datos: Logged en consola

### Logs de Depuración
El endpoint `/api/redemptions/history` tiene logs activos para depuración:
- `Historial - Username`: Nombre de usuario recibido
- `Historial - User error/data`: Resultados de búsqueda de usuario
- `Historial - Redemptions error/data`: Resultados de consulta de canjes

### Fix de user_role
El tipo enum `user_role` se crea con verificación de existencia para evitar error 42710 (duplicate_object) en Supabase.

---

## Próximos Pasos Sugeridos

1. **Remover logs de depuración** del endpoint `/api/redemptions/history`
2. **Agregar items de prueba** a la tabla `shop_items` en Supabase
3. **Implementar autenticación** real (actualmente usa solo username)
4. **Agregar página de perfil** para usuarios
5. **Implementar sistema de notificaciones** en tiempo real para canjes
6. **Agregar límites de compra** para prevenir abusos
7. **Implementar rollback** en caso de fallo en canjes
8. **Agregar analytics** de donaciones y canjes
9. **Optimizar índices** de base de datos para consultas frecuentes
10. **Agregar tests** unitarios para endpoints

---

## Cómo Ejecutar

### Instalación
```bash
cd backend
npm install
```

### Configuración
Copiar `.env.example` a `.env` y llenar las variables de Supabase.

### Ejecutar Servidor
```bash
cd backend
node server.js
```

### Acceder
- Dashboard: http://localhost:3000/dashboard
- Overlay: http://localhost:3000

---

## Fecha de Documentación
11 de octubre de 2026
