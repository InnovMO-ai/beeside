# Precision V1.0 — Cierre de Feature Complete interno (15-oct-2026)

Rama `feature/precision-continuity-foundation` (sin push). Cierra el bloque pedido tras el checkpoint de editions/KSeed.

## A. ¿Precision V1.0 es internamente Feature Complete en modo simulado?
**SÍ.** Cada punto del cierre está implementado y probado de punta a punta con el caso portugués (entidad local, matriz en Portugal que financia con préstamo, servicios y equipo intragrupo, personal mixto).

## B. Brechas internas que quedan
**Ninguna.** Una nota de alcance, que no es brecha: las reglas de materialidad (abajo) cubren hoy Fiscal, Legal/Corporativo, Personas y Aduanas, que son las categorías con manifiesto propio y señales del Frame. Logística y las categorías genéricas siguen con la readiness de su manifiesto. Ampliar las reglas es agregar datos a una tabla, no tocar arquitectura.

## C. Lo que sigue pendiente, separado
**Contenido.**
- «Doing business in Mexico» (llega mañana): la ruta ya está construida; al llegar se ingiere, se registra su HTTPS, se expone en Admin y se ofrece en Understanding. Sin cambios de código.
- Material para las 12 brechas de KSeed y la aprobación de The Hive de fuentes y revisores: ver el pack `precision-kseed-source-request-pack-2026-10-15.md`.
- ICE 2026: no bloquea; al llegar entra como nueva edición de la serie.

**Credenciales externas.** Modelo real con ZDR; sandbox de Stripe; credenciales de ClickUp / Operation Hub.

**Bloqueos de Public Ready (trabajo posterior a FC).** Contrato canónico de Discovery y Beta KB; ensayo con modelo real; corrida de Stripe sandbox; aceptación real de ClickUp/OH del bloque `understanding`; política de retención; recorridos humanos finales.

## Qué cambió en este bloque

**1. Readiness = suficiencia material para ESTE proyecto (regla corregida).**
Ya no basta con que los campos bloqueantes genéricos estén completos. Lo que el proyecto ya dijo (matriz extranjera, financiamiento de la matriz, operaciones intragrupo, personal mixto) hace *materiales* ciertas dimensiones de cada categoría, y la categoría no se declara entendida mientras alguna de ellas no se haya explorado con el cliente. Implementación: un *overlay* de materialidad se guarda como hecho de sistema de la categoría, lo calcula la capa de Understanding a partir del Frame y lo lee el mismo motor de readiness (sin tocar los puntos de uso). Cada dimensión material aparece como ítem crítico `material:<campo>` hasta que se pregunte. «No lo sé» o «prefiero no decirlo» cuenta como explorado (conocimiento honesto) y pasa al especialista como pendiente; un campo que nadie preguntó, no. Si el propio cliente contradice la premisa («no habrá operaciones intercompañía») la regla se retira sola. Sin señales no se agrega ninguna exigencia (no se infla el checklist).

Reglas vigentes (datos revisables por Producto):

| Categoría | Señales | Dimensiones que se vuelven materiales |
|---|---|---|
| Fiscal | matriz extranjera + presencia/financiamiento/intragrupo | marco contable; si hay que reportar a la matriz |
| Fiscal | operaciones intragrupo (servicios, equipo, préstamos, regalías) o préstamo de la matriz | operaciones con el grupo; contraparte, tipo, valor anual esperado y si hay contrato escrito (una vez para el grupo, no por operación); estado de la documentación de precios de transferencia (aunque el servicio no se haya nombrado) |
| Legal/Corporativo | matriz extranjera + entidad local, o socio local | accionistas, país, porcentaje |
| Personas | matriz extranjera + contratación directa | estado de la entidad local para efectos laborales |
| Aduanas | equipo/bienes con el grupo | si las operaciones son entre partes relacionadas |

Un préstamo de la matriz ahora se hereda como operación intragrupo de financiamiento. Resultado en el caso portugués: Fiscal ya no queda «lista» tras las preguntas genéricas; el siguiente paso natural es marco contable, reporte a la matriz, valor y contrato de las operaciones del grupo y estado de precios de transferencia (≈6 preguntas, ninguna repetida).

**2. Frontera hecho / juicio.** Corregida la regla demasiado amplia. Si Precision puede obtener razonablemente el *hecho* del cliente, lo pregunta; el especialista recibe solo juicio profesional, interpretación legal/fiscal/laboral, validación externa, análisis o decisión de ejecución, más lo que el cliente honestamente no sabe o no quiso decir. Aplicado en tres puntos: los aspectos materiales sin campo en la categoría ya no se mandan al especialista, siguen abiertos en el Frame (`openInProject`) y cuentan en la readiness; los hallazgos dejaron de pedir hechos («confirmar origen del equipo» ahora es juicio de aduanas; el origen lo cuenta el cliente en la categoría); y la regla queda escrita como contrato en `findings.ts`.

**3. Hechos transversales.** Un hecho material que no tiene dueño en la taxonomía (una filial que ya existe, un socio local, un contrato ancla, políticas del grupo, registros previos, flujos en otra moneda, sector con licencia, grupo auditado) se captura de forma determinista con la oración del cliente (verificada en su texto, sin hipótesis ni propuestas de la IA), se guarda como dimensión del Frame, alimenta las señales de materialidad, viaja en el contexto del payload y aparece en las categorías relevantes.

**4. «Lo que ya sé de esta parte de tu proyecto» (opción B aprobada).** Panel compacto de 3–4 líneas en lenguaje del cliente, derivado de hechos canónicos (nunca de estado técnico ni de propuestas de la IA), con botón *Corregir* por línea que precarga en el composer «Corrijo lo de «…»: » para que el motor de corrección existente lo aplique con procedencia `client_corrected`. Escritorio: abierto sobre la conversación. Móvil: una sola línea que se abre a demanda, botones de 44 px, sin empujar la conversación fuera de pantalla.

**5. Pack de solicitud de fuentes KSeed.** Una página compacta con las 12 brechas y solo seis campos por brecha (tema exacto, unidad mínima V1, tipo de fuente oficial preferida, fuente sugerida **NO APROBADA**, riesgo, perfil de revisor). Se genera con `kseed-report --pack-out` y está en Admin.

## Regresión
- Unit backend: 74 suites, 1760 pruebas, verdes (incluye guarda de arquitectura sin red/búsqueda en vivo).
- Integración en PostgreSQL limpio: 33 suites, 289 pruebas, verdes (Portuguese E2E, Preview, payload simulado a OH, journey, fiabilidad, conocimiento).
- IMCO real con los tres PDFs: 5/5. SQL de Precision en base limpia: 339 aserciones OK. Sin migración nueva en este bloque.
- Frontend: tsc y eslint limpios, 153 pruebas verdes (incluye el panel en es/en); DTO sincronizado.
- Se actualizaron dos expectativas del E2E por la regla nueva (la categoría Fiscal ahora explora lo material antes de estar lista; el préstamo de la matriz aparece como operación de financiamiento).
