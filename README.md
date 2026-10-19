# NetHub

Bloc de notas visual para documentar una red. Todo se guarda en el navegador: sin servidor, sin dependencias, sin recursos externos. Los mapas van al almacén OPFS (sin el tope de 5 MB de localStorage) y, si el navegador no lo permite, a `localStorage`. Abre `index.html` (o sirve la carpeta con cualquier servidor estático).

## Qué incluye

- **Mapa** con 4 capas: física (cables, puertos, IPs), lógica (redes/VLAN), overlays (VPN) y servicios (paneles).
- **Modelo**: nodos anidables (host > VM > contenedor), interfaces tipadas (bridge, VLAN, Wi-Fi, túnel...), redes con CIDR/VLAN/DHCP, overlays con rutas anunciadas, servicios con URL, grupos colapsables y varios mapas.
- **Inventario** en tablas editables, **Redes** con uso de direcciones y siguiente IP libre, y **Paneles** como lanzador.
- Búsqueda `Ctrl+K`, deshacer/rehacer, multiselección, copiar/pegar, alinear, ordenar automáticamente, versiones y revisión de la red (IPs duplicadas, redes solapadas, cables redundantes).
- Importar: JSON de NetHub (también el formato anterior), `tailscale status --json`, XML de nmap y CSV.
- Exportar: JSON, CSV, Markdown, Mermaid, draw.io, SVG y PNG.

## Notas

- No guardes contraseñas: usa un campo para indicar dónde está la credencial. Los exports son texto plano.
- OPFS es un almacén interno del navegador, no un archivo visible: si borras los datos del sitio se pierde igual que con localStorage. Exporta copias de vez en cuando.
- Si el navegador no ofrece OPFS se usa localStorage (~5 MB); la barra de estado indica cuál está activo y el espacio usado.
- El cálculo de redes es solo IPv4.
