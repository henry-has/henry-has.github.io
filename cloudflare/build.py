# Builds cloudflare/worker.js by inlining the game's level and solver code from spotweld/index.html.
import pathlib
root=pathlib.Path(__file__).resolve().parent
html=(root.parent/'spotweld/index.html').read_text()
core=html[html.index('const SQ3='):html.index('/* ---------- bot (par)')]
core=core.replace('const $=id=>document.getElementById(id);','')
(root/'worker.js').write_text((root/'worker.src.js').read_text().replace('/*CORE*/',core))
print('wrote',root/'worker.js')
