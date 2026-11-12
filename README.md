# Malas Cartas

Juego de cartas multijugador con la baraja española, para jugar en el navegador con amigos.

**Jugar:** https://wike1701.github.io/malas-cartas/

## Cómo jugar online
1. Uno pulsa **Crear sala** y comparte el código de 5 letras (o el enlace de invitación).
2. Los demás escriben el código y pulsan **Unirse** (2 a 6 jugadores).
3. El anfitrión pulsa **Empezar**. Importante: la partida vive en el navegador del anfitrión, así que no debe cerrar su pestaña.

Si alguien se desconecta, el juego juega por él hasta que vuelva (recargando la página y uniéndose con el mismo código desde la misma pestaña).

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
- `app.js`: red e interfaz.
- `test.js`: pruebas de las reglas (`node test.js`).
