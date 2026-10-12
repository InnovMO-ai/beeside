# Evidencia Gate R2 — paso 7: latencia del guard y del gateway (modelo SIMULADO)

- fecha (UTC): 2026-10-08T00:13:06Z
- método: ejecución real en la máquina del operador (Node v22.23.2, tsx tsx v4.23.13), importando el código real del Engine Foundation de la rama bajo prueba. **Modelo simulado** (fetch inyectado con latencia configurable); sin cuenta de proveedor, sin datos reales, sin red.
- rama: feature/precision-engine-foundation-rebased; SHA: 0b55a376199864a7d63a0a3098a7334ebb0f53cc (no está en el remoto; ver parches)
- arnés: `r2_latency_harness.ts` (en esta misma carpeta)
- Alcance honesto: mide el **costo propio** del código (guard, gateway, extracción) y el **comportamiento ante fallas/timeouts**. NO mide latencia de un modelo real (primer token, turno completo): eso requiere la cuenta de modelos de desarrollo (F4).

## Resultados (salida literal)

```
{"label":"A1 guard layers 1+2 only (regex+heuristic), mixed corpus up to ~3.7k chars","n":20000,"p50":"0.0009","p95":"0.0136","p99":"0.0142","max":"0.4985","unit":"ms"}
{"label":"A2 guard() with useModelLayer:false (async wrapper included)","n":5000,"p50":"0.0015","p95":"0.0138","p99":"0.0163","max":"0.5332","unit":"ms"}
{"label":"B1 gateway chat() overhead, simulated model 0 ms, ~1.4k-char prompt","n":5000,"p50":"0.0087","p95":"0.0190","p99":"0.0373","max":"0.9526","unit":"ms"}
{"label":"B2 gateway chatJSON() overhead, simulated model 0 ms","n":3000,"p50":"0.0039","p95":"0.0129","p99":"0.0224","max":"2.16","unit":"ms"}
{"label":"C guard() incl. model layer: overhead above a simulated 150 ms classifier","n":60,"p50":"4.69","p95":"7.80","p99":"33.13","max":"33.13","unit":"ms"}
{"label":"C guard() incl. model layer: overhead above a simulated 400 ms classifier","n":60,"p50":"4.19","p95":"7.06","p99":"7.62","max":"7.62","unit":"ms"}
{"label":"D1 guard model layer, single target hanging (timeoutMs=1000)","verdict":"allow","layer":"fail_open","guardFailure":true,"ms":1009}
{"label":"D2 guard model layer, 3 targets all hanging (timeoutMs=1000)","verdict":"allow","layer":"fail_open","guardFailure":true,"ms":3016}
{"label":"D3 guard, 3 targets all HTTP 500 (fast failure)","verdict":"allow","layer":"fail_open","guardFailure":true,"ms":0.5}
{"label":"E1 gateway fallback: primary hangs (timeoutMs=1000), secondary 300 ms","provider":"secondary","ms":1314,"failedAttempts":1}
{"label":"E2 gateway fallback: primary HTTP 500 fast, secondary 300 ms","provider":"secondary","ms":307,"failedAttempts":1}
{"label":"E3 same, GatewayConfig.timeoutMs=20000 (default) but per-call ChatOptions.timeoutMs=800","provider":"secondary","ms":1110}
{"label":"F extraction, simulated 400 ms model","okMs":406,"withOneMalformedRetryMs":816,"attemptedRetry":true}
DEFAULT gateway timeout (no env override): 20000 ms per attempt per target
```

(Las secciones A–C y D–F salieron de dos ejecuciones del mismo arnés: la primera terminó tras C porque los temporizadores de `AbortSignal.timeout` no mantienen vivo el proceso de Node y mi arnés no tenía un temporizador de respaldo; se corrigió el arnés —`setInterval` de respaldo y `SKIP_ABC=1`— y D–F se ejecutaron aparte. Cada sección es independiente.)

## Lectura frente a F3 §9

| Medida de F3 §9 | Resultado | Lectura |
|---|---|---|
| Capas deterministas del guard (regex + heurística) | p99 0.014 ms, máx. 0.5 ms (20 000 iteraciones, textos de hasta ~3.7 k caracteres) | Despreciable frente a cualquier presupuesto |
| Sobrecosto propio del gateway (JSON, señal de timeout) | p99 0.04 ms (chat) / 0.02 ms (chatJSON) | Despreciable |
| Sobrecosto del guard con capa de modelo (por encima del clasificador) | p50 ≈ 4–5 ms, p95 ≈ 7–8 ms | Dominado por la latencia del clasificador, no por el código |
| Reintento de forma en extracción | 406 ms → 816 ms (duplica) | Cabe en el presupuesto de turno 6 s solo si el modelo responde < ~2.5 s |
| **Peor caso con proveedor colgado** | tiempo = timeoutMs × n.º de destinos (D1 1.0 s, D2 3.0 s con timeoutMs=1 000). **Con el valor por defecto de 20 000 ms: 20 s por destino, hasta 60 s con 3 destinos** | **Excede el presupuesto de turno (6 s) por un orden de magnitud.** Hallazgo de configuración/código (ver abajo) |
| Falla rápida (HTTP 5xx) en toda la cadena | 0.5 ms hasta el veredicto fail-open; fallback 307 ms | Bien |

## Hallazgos (delta documentado; nada se corrigió en este paso)

1. `GatewayConfig.timeoutMs` por defecto = 20 000 ms por intento y por destino. Con un proveedor colgado el turno puede tardar hasta 20 s × n destinos. Mitigación existente: `ChatOptions.timeoutMs` por llamada (E3 la valida). **Falta**: el guard (`classifyWithModel`) no expone ni pasa ese parámetro, así que hoy el clasificador de inyección hereda los 20 s por destino en el camino de entrada de **cada mensaje del cliente**.
2. Cambio mínimo, reversible y aditivo propuesto (para F5, no ahora): `GuardOptions.timeoutMs` (opcional) pasado a `chat()`, con valor configurable por variable de entorno; sin cambiar el comportamiento si no se define. Las pruebas A/B/E3 de este arnés sirven de base.
3. El gateway actual intenta **una vez por destino** (sin reintento interno); el informe histórico del 2 oct hablaba de reintentos por modelo, pero ese informe está invalidado (Addendum 7) y el código real no los tiene. Coherente con el diseño actual; no es una falla.
