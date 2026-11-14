# Escondemóviles

Juego de escondite con móviles para jugar en grupo con la tele. Uno sale de la habitación, los demás esconden su móvil, y los móviles escondidos **suenan de vez en cuando** hasta que los encuentra.

**Jugar en la tele:** https://wike1701.github.io/malas-cartas/escondemoviles/?tv
**Unirse desde el móvil:** escanea el QR que sale en la tele (o entra en https://wike1701.github.io/malas-cartas/escondemoviles/ y escribe el código).

## Cómo funciona
Funciona igual que el modo TV de Malas Cartas: la tele crea la sala (PeerJS), guarda la partida y le manda a cada móvil lo que tiene que ver. Los móviles solo hacen de mando. Además, la tele decide cuándo suena cada móvil escondido, para que nunca suenen dos a la vez.

1. Abre el juego en la tele: con la app **Escondemóviles** del Fire TV o abriendo `?tv` en cualquier navegador conectado a la tele.
2. Cada jugador escanea el QR, escribe su nombre y pulsa **Unirse** (2 a 8 jugadores). En la sala puede elegir avatar y **su sonido** (pajarito, robot, campana, rana, silbido, grillo, pato o sirena) y probarlo.
3. El primero que entra (👑) elige los tiempos y pulsa **Empezar**. También se puede empezar con el mando de la tele.

## Reglas
- En cada ronda le toca buscar a uno (todos buscan una vez, en el orden en que entraron).
- **Esconder:** quien busca sale de la habitación o se tapa los ojos. Los demás esconden su propio móvil y pulsan **Ya está escondido**: la pantalla se queda negra para que no la delate la luz. La búsqueda empieza cuando están todos escondidos o se acaba el tiempo (30, 60 o 90 s). Con el mando de la tele se puede empezar antes (**¡A buscar ya!**).
- **Buscar:** los móviles escondidos suenan cada uno con su sonido, primero cada 9 segundos más o menos y, al final, cada 3. También vibran. Quien busca tiene una **pista** por ronda: hace que suenen todos, uno detrás de otro. Tiempo: 60, 90, 120 o 180 s.
- Cuando encuentras un móvil, **mantén pulsada su pantalla** un segundo. En la tele se marca como encontrado.
- **Puntos:** quien busca gana 1 punto por móvil encontrado y 1 más si los encuentra todos. Cada móvil que no se encuentra da 2 puntos a su dueño.
- Al acabar la ronda, los móviles que no se han encontrado siguen sonando cada 3 segundos hasta que su dueño lo recoge y pulsa **Ya lo tengo**.
- Gana quien tenga más puntos al final.

## Consejos
- Sube el volumen del móvil al máximo antes de esconderlo. Con **Probar mi sonido** lo compruebas.
- El juego intenta que la pantalla no se apague mientras el móvil está escondido. Aun así, no lo bloquees ni cambies de app: si se bloquea, no suena. En iPhone, desactiva el bloqueo automático por si acaso.
- Si un móvil pierde la conexión, se reconecta solo y vuelve a su sitio en la partida.

## App para Fire TV
Igual que la de Malas Cartas: abre la web publicada a pantalla completa, no deja que la pantalla se apague, el botón central del mando pulsa el botón marcado y hay que pulsar *Atrás* dos veces para salir.

Para instalarla, en la app **Downloader** del Fire TV escribe:
`https://github.com/wike1701/malas-cartas/releases/download/escondemoviles-tv/escondemoviles-tv.apk`

La compila GitHub Actions (`.github/workflows/escondemoviles-tv.yml`) cuando cambia `escondemoviles/android-tv/` en `main`. Usa los mismos secretos de firma que la app de Malas Cartas (`TV_KEYSTORE_*`).

## Desarrollo
- `game.js`: reglas, sin red ni interfaz. Pruebas: `node test.js`.
- `app.js`: red (PeerJS), tele y móviles.
- `sound.js`: sonidos sintetizados con Web Audio, sin archivos.
