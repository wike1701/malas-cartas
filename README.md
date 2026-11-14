# Malas Cartas

Juego de cartas multijugador con la baraja española, para jugar en el navegador con amigos.

**Jugar:** https://wike1701.github.io/malas-cartas/

## Otro juego: Escondemóviles
Escondite con móviles para jugar con la tele: escondéis los móviles, suenan de vez en cuando y uno tiene que encontrarlos. Ver [escondemoviles/README.md](escondemoviles/README.md).

## Cómo jugar online
1. Uno pulsa **Crear sala** y comparte el código de 5 letras (o el enlace de invitación).
2. Los demás escriben el código y pulsan **Unirse** (2 a 6 jugadores).
3. El anfitrión pulsa **Empezar**. Importante: la partida vive en el navegador del anfitrión, así que no debe cerrar su pestaña.

Si alguien se desconecta, el juego juega por él hasta que vuelva (recargando la página y uniéndose con el mismo código desde la misma pestaña).

## Jugar en la tele (Fire TV)
La tele muestra la mesa y cada jugador juega desde su móvil con sus cartas.

1. Abre la app **Malas Cartas** en la tele. Aparece un código QR y el código de la sala.
2. Cada jugador escanea el QR con el móvil, escribe su nombre y pulsa **Unirse** (2 a 6 jugadores).
3. Empieza la partida con el mando de la tele (botón central) o desde el móvil del primero que se unió (👑).
4. En la tele se ven los asientos, las vidas, lo que dice cada uno y las cartas que se tiran. El móvil hace de mando, en horizontal: solo muestra tu mano, tus vidas y los botones para decir cuántas mini rondas ganas. Si está en vertical, pide girarlo, y en Android un botón lo pone en pantalla completa y horizontal.
5. Al acabar cada ronda se muestra el resumen y la siguiente empieza sola a los 15 segundos (o antes, con el botón).

En la ronda de 1 carta, la tele no enseña ninguna carta. Cada uno ve en su móvil las de los demás.

Sin la app también funciona: abre `https://wike1701.github.io/malas-cartas/?tv` en cualquier pantalla.

### Instalar la app en el Fire TV
1. En el Fire TV, instala la app **Downloader** desde la tienda de Amazon.
2. Ve a *Configuración → Mi Fire TV → Opciones para desarrolladores → Instalar apps desconocidas* y activa **Downloader**. Si no ves *Opciones para desarrolladores*, entra en *Mi Fire TV → Acerca de* y pulsa 7 veces sobre el nombre del dispositivo.
3. Abre Downloader y escribe esta dirección:
   `https://github.com/wike1701/malas-cartas/releases/download/tv-app/malas-cartas-tv.apk`
4. Pulsa **Instalar**. La app aparece en *Tus apps y canales*, con el banner de Malas Cartas.

En la tele, el botón *Atrás* hay que pulsarlo dos veces para salir, para no cerrar la partida sin querer. La app no deja que la pantalla se apague mientras está abierta.

La app abre la web publicada, así que las mejoras del juego llegan sin reinstalarla. El APK lo compila GitHub Actions (`.github/workflows/android-tv.yml`) cada vez que cambia `android-tv/` en `main`, y lo publica en la release `tv-app`.

Para que cada APK nuevo se instale encima del anterior sin desinstalar, crea una clave de firma y guárdala en los secretos del repositorio (`TV_KEYSTORE_BASE64`, `TV_KEYSTORE_PASSWORD`, `TV_KEY_ALIAS`, `TV_KEY_PASSWORD`):

```bash
keytool -genkeypair -v -keystore tv.jks -alias malascartas -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 tv.jks
```

Sin esos secretos el APK se firma con una clave temporal, y para actualizarlo hay que desinstalar antes la versión anterior.

## Pantalla completa
En el móvil y en el ordenador, el botón ⛶ (arriba a la derecha) pone el juego en pantalla completa. En iPhone el navegador no lo permite y el botón no aparece.

## Avatares, sonido y animaciones
- Elige uno de los 16 personajes o sube tu propia foto (se recorta y comprime en el navegador). Se puede cambiar también en la sala de espera.
- Efectos de sonido sintetizados (reparto, tirada, baza ganada, vidas perdidas, victoria…). Botón 🔊 arriba para silenciar; se recuerda.
- Animaciones de reparto, cartas que caen a la mesa y se van hacia quien gana la baza, corazones que se rompen y medalla final. Se desactivan si el sistema pide reducir el movimiento.

## Reglas
- Cada jugador tiene **5 vidas**.
- Se reparten 5 cartas, luego 4, 3, 2, 1, se vuelve a subir hasta 5 y así hasta que solo quede uno.
- Antes de jugar, cada uno dice cuántas mini rondas va a ganar. La suma de lo que dicen todos **nunca puede ser igual** al número de mini rondas (el último tiene un número prohibido).
- Gana la mini ronda la carta más alta: **As** > Rey (12) > Caballo (11) > Sota (10) > 7 > … > 2. El palo no importa. Si se repite número (por ejemplo dos ases), gana la primera que se tiró.
- En la **ronda de 1 carta** ves las cartas de los demás, pero no la tuya.
- Al final de cada ronda pierdes tantas vidas como mini rondas te hayas pasado o te hayan faltado. Con 0 vidas quedas eliminado.

## Técnica
Web estática (HTML/CSS/JS sin dependencias de compilación). La conexión entre jugadores es directa (WebRTC) mediante [PeerJS](https://peerjs.com/).

- `game.js`: reglas del juego.
- `app.js`: red e interfaz (incluido el modo TV, `?tv`).
- `vendor/qrcode.js`: generador de códigos QR ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT).
- `android-tv/`: app Android para Fire TV / Android TV (un WebView a pantalla completa que abre el modo TV).
- `avatars.js`, `sound.js`, `fx.js`: avatares, sonidos y detección de eventos para las animaciones (adaptados de secrethitlet).
- `test.js`: pruebas de las reglas, avatares y eventos (`node test.js`).
