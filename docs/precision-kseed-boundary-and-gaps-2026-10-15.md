# KSeed: frontera, comportamiento y brechas (15 oct 2026)

Checkpoint del bloque «Precision / Knowledge». Estado: construido, probado y confirmado en commit; sin push.

## La frontera, tal como queda en el producto

KSeed (Knowledge Seed) es el caché interno, preparado y reutilizable que Precision consume. Se construye con el material que proporcionas y apruebas (IMCO, «Doing business in Mexico», referencias oficiales aprobadas, reportes institucionales, material país curado a futuro). Ese material no autoriza ninguna búsqueda web en vivo: Precision es knowledge-first, no search-first. La fuente de verdad de largo plazo es la Knowledge Layer, que mantendrá un Knowledge Agent separado del diálogo; Precision solo lee lo ya aprobado.

## Cómo se comporta Precision cuando el cliente pregunta algo de conocimiento

1. Consulta el conocimiento aprobado, y solo ese. No existe ninguna ruta de red dentro de Precision; una prueba arquitectónica falla si alguien introduce un cliente HTTP, un `fetch` o un buscador en cualquier módulo de Precision, o si el Knowledge Agent queda conectado a la conversación.
2. Si hay material aprobado y pertinente, orienta con él, nombrando fuente, edición y página, y diciendo que es contexto, no obligación ni recomendación.
3. Si no alcanza, lo dice con una frase honesta («todavía no lo tengo en la información que beeside ha revisado y aprobado»), no improvisa y sigue con la siguiente pregunta del diagnóstico.
4. Registra la demanda de conocimiento, normalizada y sin texto del cliente: país, tema, subtema, categoría y servicio, tipo de información pedida, cobertura (ausente o parcial), si es posible conocimiento futuro o servicio de especialista, y la recurrencia. La base de datos solo admite vocabulario controlado; un texto libre o un dato personal no puede entrar. La recurrencia (ocurrencias y proyectos distintos) se cuenta con huellas irreversibles y nunca publica nada: solo una persona, desde Admin, decide si algo pasa a curación, se queda como servicio o se descarta.
5. Deja una nota normalizada para el especialista del proyecto y lo enruta a The Hive.

## La frontera comercial y profesional

Cuando el cliente pide una determinación sobre su operación (la mejor opción de puerto o ubicación, una conclusión fiscal, una opinión legal, asesoría laboral, optimización logística, comparar mercados de entrada, una recomendación de inversión), Precision da el contexto aprobado que exista y dice que definirlo es trabajo de un especialista de beeside. Puede explicar el papel general de Manzanillo; no afirma que sea la mejor opción para una operación concreta. Está probado para los siete tipos en español y para los casos clave en inglés.

## Qué cambió en el código

Nuevo: guarda de límite profesional, registro de demanda (dominio, puerto, repositorio Postgres, tablas con restricciones y registro de privacidad), tres textos de cliente (límite sin cobertura, límite parcial, frontera profesional), rutas Admin (ver demanda, decidir, estado de KSeed con reporte), el script `kseed-report`, y la matriz KSeed de 27 necesidades para México. De paso se corrigieron dos defectos de calidad: las siglas cortas (ISR, IVA, SAT) etiquetaban temas por coincidencia dentro de otras palabras, y Precision podía responder con un pasaje solo por compartir palabras sueltas con la pregunta; ahora el pasaje tiene que ser del tema preguntado. También: si el cliente nombra un municipio y no hay contexto que dar, ya no promete «contexto del estado» que no llega.

## Una limitación conocida

Una pregunta que mezcla un hecho del proyecto («¿cuál es el mejor estado para contratar a 60 personas?») la lee el intérprete como información del proyecto, no como pregunta de conocimiento, y sigue el diagnóstico sin pasar por la orientación. Riesgo: bajo en V1, porque el diagnóstico sigue y el hecho queda capturado. Opciones: (A) dejarlo así hasta el ensayo con modelo real; (B) separar siempre pregunta y hecho en el intérprete por reglas. Recomendado A: el intérprete con modelo, que se ensaya para Public Ready, separa ambas cosas mejor que un parche de reglas.

## Verificación

Unit 1,726; integración 290 sobre base limpia (4 pruebas E2E nuevas de knowledge-first y una de Admin); SQL con pruebas nuevas D1 a D6 y U22 actualizada; front 151; tsc y eslint limpios; verificador de DTO sin cambios. Cobertura medida con el ICE 2025 real (libro con 1,784 pasajes y anexo con 35).

Generado el 2026-10-15. Todo lo que aparece aquí sale de material aprobado e ingerido; Precision no busca en la web durante las conversaciones.

## Resumen

KSeed cubre hoy 6 de 27 necesidades de conocimiento definidas para México (5 parciales, 16 sin material). De las 15 necesarias para V1 Feature Complete, 3 están cubiertas y 12 siguen abiertas.

La lectura de negocio: lo que hoy sostiene bien a Precision es el contexto estatal (competitividad, mercado laboral, infraestructura) gracias al ICE de IMCO. Lo que todavía no tiene es la capa de obligaciones (corporativo, fiscal, laboral y de seguridad social, aduanas y migración): no hay ninguna fuente oficial primaria ingerida, así que Precision reconoce el límite, sigue el diagnóstico, registra la demanda y enruta al especialista de The Hive, sin improvisar.

## Qué contiene KSeed hoy

| Fuente | Documento | Edición | Autoridad | Temas |
|---|---|---|---|---|
| Instituto Mexicano para la Competitividad (IMCO) | Índice de Competitividad Estatal 2025 (anexo metodológico) | 2025 (v1) | institucional confiable | rule_of_law, infrastructure, labor_market, economy_innovation, transportation_logistics, education_talent |
| Instituto Mexicano para la Competitividad (IMCO) | Índice de Competitividad Estatal 2025 (libro) | 2025 (v1) | institucional confiable | labor_market, infrastructure, economy_innovation, transportation_logistics, wages, education_talent |

Guía país para clientes: «Doing business in Mexico» aún no está registrada; falta el PDF final de beeside (ver «Qué necesitamos de ti»).

Edición pendiente: imco-ice 2026. El sitio de IMCO ya muestra el ICE 2026; la arquitectura lo incorpora como versión nueva que sustituye a la 2025.

## Matriz de cobertura

| Id | Tema / subtema | Categorías | Tipo | Estado | V1 |
|---|---|---|---|---|---|
| mx.competitiveness.state | competitiveness_state / * | industrial_real_estate, corporate_real_estate, market_intelligence | contexto | Cubierto | Necesario para V1 |
| mx.labor.availability | labor_market / * | people_payroll_employment, industrial_real_estate | contexto | Cubierto | Necesario para V1 |
| mx.infrastructure.state | infrastructure / * | logistics, industrial_real_estate | contexto | Cubierto | Necesario para V1 |
| mx.rule_of_law.state | rule_of_law / * | market_intelligence, corporate_real_estate | contexto | Cubierto | Puede esperar |
| mx.wages.benchmarks | wages / salary_benchmarks | people_payroll_employment | contexto | Cubierto | Puede esperar |
| mx.education.talent | education_talent / * | people_payroll_employment, market_intelligence | contexto | Cubierto | Puede esperar |
| mx.corporate.entity_types | corporate_law / entity_types | corporate_legal_admin | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.corporate.incorporation | corporate_law / incorporation_steps | corporate_legal_admin | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.corporate.foreign_ownership | foreign_investment / foreign_ownership | corporate_legal_admin | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.tax.income_tax | taxes / income_tax | tax_accounting_audit | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.tax.vat | taxes / vat | tax_accounting_audit | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.tax.transfer_pricing | taxes / transfer_pricing | tax_accounting_audit | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.tax.withholding | taxes / withholding | tax_accounting_audit | obligaciones (fuente oficial) | Falta | Puede esperar |
| mx.tax.registration | taxes / tax_registration | tax_accounting_audit, corporate_legal_admin | obligaciones (fuente oficial) | Falta | Puede esperar |
| mx.treaty.pt-mx | taxes / withholding | tax_accounting_audit | obligaciones (fuente oficial) | Falta | Puede esperar |
| mx.labor.hiring_model | labor_market / hiring_model | people_payroll_employment | obligaciones (fuente oficial) | Parcial | Necesario para V1 |
| mx.labor.mandatory_benefits | wages / mandatory_benefits | people_payroll_employment | obligaciones (fuente oficial) | Parcial | Necesario para V1 |
| mx.social_security.imss | social_security / imss_registration | people_payroll_employment | obligaciones (fuente oficial) | Parcial | Necesario para V1 |
| mx.immigration.work_visas | immigration_mobility / work_visas | people_payroll_employment, corporate_legal_admin | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.customs.regimes | customs / duty_regimes | international_trade_customs, logistics | obligaciones (fuente oficial) | Falta | Necesario para V1 |
| mx.customs.classification | customs / tariff_classification | international_trade_customs | obligaciones (fuente oficial) | Falta | Puede esperar |
| mx.trade.agreements | exports_trade / trade_agreements | international_trade_customs | obligaciones (fuente oficial) | Falta | Puede esperar |
| mx.logistics.ports | transportation_logistics / ports_and_borders | logistics, international_trade_customs | contexto | Parcial | Necesario para V1 |
| mx.logistics.freight | transportation_logistics / freight_costs | logistics | contexto | Falta | Puede esperar |
| mx.realestate.industrial | infrastructure / industrial_parks | industrial_real_estate | contexto | Falta | Puede esperar |
| mx.investment.incentives | foreign_investment / investment_incentives | corporate_legal_admin, tax_accounting_audit | obligaciones (fuente oficial) | Falta | Puede esperar |
| mx.finance.banking | financial_access / general | banking_finance_insurance | obligaciones (fuente oficial) | Parcial | Puede esperar |

## Brechas, una por una

Cada brecha dice qué falta, por qué Precision lo necesita, a qué país, tema y categoría pertenece, qué tipo de fuente es la ideal, el riesgo y si V1 Feature Complete lo exige. Las fuentes ideales son sugerencias para que Producto y The Hive las confirmen; ninguna queda aprobada por estar aquí.

### mx.corporate.entity_types — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar las formas jurídicas principales que puede usar una empresa extranjera en México (subsidiaria o sucursal; S.A. de C.V., S. de R.L., SAPI) para que el cliente haga las preguntas correctas.
Por qué lo necesita Precision: Caso de aceptación obligatorio (empresa portuguesa): la decisión de la entidad abre todas las demás categorías.
País, tema y categoría: MX; corporate_law / entity_types; corporate_legal_admin.
Fuente ideal: Fuentes oficiales primarias (Ley General de Sociedades Mercantiles, Secretaría de Economía) más unidades curadas por beeside y revisadas por el socio legal de The Hive.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Recomendar la forma de la entidad y estructurarla.

### mx.corporate.incorporation — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Describir la secuencia general y los tiempos para constituir y registrar una empresa.
Por qué lo necesita Precision: Los clientes planean su fecha de arranque alrededor del tiempo de constitución.
País, tema y categoría: MX; corporate_law / incorporation_steps; corporate_legal_admin.
Fuente ideal: Secretaría de Economía / gob.mx, Registro Público de Comercio, guías de inscripción del SAT.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Ejecutar la constitución.

### mx.corporate.foreign_ownership — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar a nivel de orientación las reglas de inversión extranjera (sectores restringidos, registro de la inversión extranjera).
Por qué lo necesita Precision: Algunos sectores (entre ellos energía) tienen reglas específicas; hay que preguntarlas pronto.
País, tema y categoría: MX; foreign_investment / foreign_ownership; corporate_legal_admin.
Fuente ideal: Ley de Inversión Extranjera, Secretaría de Economía (RNIE), DOF.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Opinión legal sobre el sector y la estructura del cliente.

### mx.tax.income_tax — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar en términos generales cómo funciona el impuesto sobre la renta empresarial, para que el cliente entienda qué preguntar.
Por qué lo necesita Precision: Todo proyecto con entidad llega a lo fiscal; Precision debe hablar con el vocabulario correcto.
País, tema y categoría: MX; taxes / income_tax; tax_accounting_audit.
Fuente ideal: SAT, Ley del Impuesto sobre la Renta (DOF), unidades curadas por beeside.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Conclusiones y planeación fiscal del caso del cliente.

### mx.tax.vat — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar a nivel de orientación el IVA básico y sus devoluciones.
Por qué lo necesita Precision: El flujo de caja del IVA es una pregunta temprana estándar para importadores, exportadores y empresas de servicios.
País, tema y categoría: MX; taxes / vat; tax_accounting_audit.
Fuente ideal: SAT, Ley del IVA (DOF).
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Tratamiento del IVA y gestión de devoluciones.

### mx.tax.transfer_pricing — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar que las operaciones entre partes relacionadas tienen obligaciones de documentación y qué preguntar.
Por qué lo necesita Precision: Caso de aceptación obligatorio: la matriz financia y factura a la filial.
País, tema y categoría: MX; taxes / transfer_pricing; tax_accounting_audit.
Fuente ideal: SAT, disposiciones de precios de transferencia de la LISR (DOF); guías de la OCDE como contexto.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Política y documentación de precios de transferencia.

### mx.labor.hiring_model — Parcial
Qué falta: Hay contexto institucional sobre el tema, pero ninguna fuente oficial primaria que permita hablar de obligaciones.
Qué permitiría a Precision: Explicar a nivel de orientación los modelos de contratación (directa, terceros con sus requisitos de registro, empleador de registro).
Por qué lo necesita Precision: Caso de aceptación obligatorio: contratación directa más un tercero; importa la reforma de servicios especializados.
País, tema y categoría: MX; labor_market / hiring_model; people_payroll_employment.
Fuente ideal: STPS, Ley Federal del Trabajo (DOF), guías del REPSE, unidades curadas por beeside.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Elegir y estructurar el modelo de contratación.

### mx.labor.mandatory_benefits — Parcial
Qué falta: Hay contexto institucional sobre el tema, pero ninguna fuente oficial primaria que permita hablar de obligaciones.
Qué permitiría a Precision: Explicar que existen prestaciones de ley (aguinaldo, prima vacacional, reparto de utilidades) para no subestimar presupuestos.
Por qué lo necesita Precision: Los clientes presupuestan solo el salario; la capa legal cambia el costo total.
País, tema y categoría: MX; wages / mandatory_benefits; people_payroll_employment.
Fuente ideal: STPS, Ley Federal del Trabajo (DOF).
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Diseño de compensación y prestaciones.

### mx.social_security.imss — Parcial
Qué falta: Hay contexto institucional sobre el tema, pero ninguna fuente oficial primaria que permita hablar de obligaciones.
Qué permitiría a Precision: Explicar a nivel de orientación el registro patronal y las cuotas.
Por qué lo necesita Precision: Todo patrón debe registrarse; el cliente debe saberlo antes de contratar.
País, tema y categoría: MX; social_security / imss_registration; people_payroll_employment.
Fuente ideal: IMSS, INFONAVIT, SAR/AFORE (oficiales), DOF.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Registro y puesta en marcha de nómina.

### mx.immigration.work_visas — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar que reubicar personal requiere condición migratoria y qué preguntar.
Por qué lo necesita Precision: Caso de aceptación obligatorio: parte del equipo del proyecto se reubica.
País, tema y categoría: MX; immigration_mobility / work_visas; people_payroll_employment, corporate_legal_admin.
Fuente ideal: Instituto Nacional de Migración, gob.mx.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Trámites migratorios y elección de la condición de estancia.

### mx.customs.regimes — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar a nivel de orientación los regímenes de importación y exportación (importación temporal, regímenes fiscalizados) y qué preguntar.
Por qué lo necesita Precision: Exportadores, importadores y manufactureros necesitan el vocabulario antes de que un especialista aduanero tome el caso.
País, tema y categoría: MX; customs / duty_regimes; international_trade_customs, logistics.
Fuente ideal: Agencia Nacional de Aduanas de México (ANAM), guías aduaneras del SAT, Secretaría de Economía (IMMEX), DOF.
Riesgo: alto. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Selección de régimen y cumplimiento aduanero.

### mx.logistics.ports — Parcial
Qué falta: Hay material sobre el tema, pero no de una fuente con el nivel o la autoridad requeridos.
Qué permitiría a Precision: Explicar el papel general de los puertos y cruces fronterizos principales (por ejemplo, por qué se conoce Manzanillo) sin decir cuál es mejor para una operación específica.
Por qué lo necesita Precision: Los clientes de logística llegan con nombres de puertos; Precision debe entender y orientar, y luego preguntar por su carga y sus flujos.
País, tema y categoría: MX; transportation_logistics / ports_and_borders; logistics, international_trade_customs.
Fuente ideal: Autoridades portuarias, estadísticas de SICT y ANAM, unidades curadas por beeside revisadas por el socio logístico de The Hive.
Riesgo: medio. Necesario para V1. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Selección de puerto y ruta, optimización de costo y tránsito.

### mx.tax.withholding — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar que los pagos al extranjero (dividendos, regalías, servicios, intereses) pueden tener retención.
Por qué lo necesita Precision: El financiamiento transfronterizo y las cuotas de gestión son comunes en proyectos de expansión.
País, tema y categoría: MX; taxes / withholding; tax_accounting_audit.
Fuente ideal: SAT, LISR (DOF); textos de los tratados (ver la entrada del tratado México–Portugal).
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Análisis de retenciones y de tratados.

### mx.tax.registration — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar a nivel de orientación la inscripción fiscal y la facturación electrónica.
Por qué lo necesita Precision: La inscripción condiciona operar, facturar y contratar.
País, tema y categoría: MX; taxes / tax_registration; tax_accounting_audit, corporate_legal_admin.
Fuente ideal: Guías del SAT (RFC, e.firma, facturación electrónica).
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Inscripción y puesta en marcha del cumplimiento.

### mx.treaty.pt-mx — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Reconocer que puede aplicar un tratado fiscal entre el país de la matriz y México.
Por qué lo necesita Precision: Caso de aceptación obligatorio: flujos Portugal–México.
País, tema y categoría: INT; taxes / withholding; tax_accounting_audit.
Fuente ideal: Textos oficiales de los tratados (SAT y publicaciones de tratados), país por país.
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Análisis de beneficios de tratado.

### mx.customs.classification — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar la clasificación arancelaria y por qué se fija por producto.
Por qué lo necesita Precision: Aranceles, permisos y origen dependen de ella.
País, tema y categoría: MX; customs / tariff_classification; international_trade_customs.
Fuente ideal: Tarifa oficial (TIGIE, DOF) y criterios de la ANAM.
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Clasificar los productos del cliente.

### mx.trade.agreements — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar que los tratados comerciales y las reglas de origen pueden afectar aranceles y qué preguntar.
Por qué lo necesita Precision: El caso del exportador de café y cualquier flujo hacia Norteamérica dependen de ellos.
País, tema y categoría: MX; exports_trade / trade_agreements; international_trade_customs.
Fuente ideal: Secretaría de Economía (tratados comerciales), textos oficiales de los tratados.
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Determinación de origen y estrategia de preferencias.

### mx.investment.incentives — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Reconocer que existen programas de incentivos federales y estatales y qué preguntas los destraban.
Por qué lo necesita Precision: Los clientes preguntan por incentivos desde el inicio; cambian seguido, así que Precision no debe improvisar.
País, tema y categoría: MX; foreign_investment / investment_incentives; corporate_legal_admin, tax_accounting_audit.
Fuente ideal: Secretaría de Economía, agencias estatales de desarrollo económico, DOF.
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Elegibilidad y solicitud de incentivos.

### mx.finance.banking — Parcial
Qué falta: Hay contexto institucional sobre el tema, pero ninguna fuente oficial primaria que permita hablar de obligaciones.
Qué permitiría a Precision: Explicar a nivel de orientación cómo una empresa de capital extranjero abre cuentas y mueve capital.
Por qué lo necesita Precision: Caso de aceptación obligatorio: la matriz financia a la filial.
País, tema y categoría: MX; financial_access / general; banking_finance_insurance.
Fuente ideal: Publicaciones de Banxico y CNBV; requisitos de apertura de los bancos.
Riesgo: alto. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Apertura bancaria y estructuración de la aportación de capital.

### mx.logistics.freight — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Dar rangos y factores del costo de flete, como contexto.
Por qué lo necesita Precision: Las conversaciones de presupuesto empiezan aquí.
País, tema y categoría: MX; transportation_logistics / freight_costs; logistics.
Fuente ideal: Reportes de la industria y estadísticas de cámaras (CANACAR, autoridades portuarias).
Riesgo: medio. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Cotizaciones y diseño de la red logística.

### mx.realestate.industrial — Falta
Qué falta: No hay material aprobado sobre este tema.
Qué permitiría a Precision: Explicar cómo se organiza el mercado de parques industriales y qué guía la elección del sitio.
Por qué lo necesita Precision: Los proyectos de sitio industrial necesitan vocabulario y criterios antes de una búsqueda.
País, tema y categoría: MX; infrastructure / industrial_parks; industrial_real_estate.
Fuente ideal: AMPIP (asociación de parques industriales), reportes de mercado de consultoras inmobiliarias.
Riesgo: medio. Puede esperar. Cuando esté cubierto, seguirá siendo trabajo de The Hive: Búsqueda de sitio, negociación y debida diligencia.

## Frontera profesional

El conocimiento orienta y ayuda a hacer mejores preguntas; no sustituye el trabajo profesional de The Hive. Precision puede explicar el papel general de Manzanillo, pero no afirma que sea la mejor opción para una operación concreta; lo mismo vale para conclusiones fiscales, opiniones legales, asesoría laboral, optimización logística, comparaciones de mercado de entrada y recomendaciones de inversión. Cuando alguien las pide, Precision da el contexto aprobado que exista, dice dónde termina y lo deja anotado para el especialista.

## Demanda de conocimiento observada

Aún no hay preguntas sin cobertura registradas. Cada una se guarda normalizada (país, tema, subtema, categoría, tipo de información, cobertura), sin texto del cliente ni datos personales; la recurrencia informa la decisión de una persona y nunca publica nada sola.

## Qué necesitamos de ti

1. El PDF final de «Doing business in Mexico»: la URL pública HTTPS para registrarlo como recurso del país y, si lo autorizas, el archivo para ingerirlo como material curado por beeside y que Precision pueda orientar con su contenido.
2. Los archivos del ICE 2026 de IMCO (o su enlace descargable) para sustituir la edición 2025.
3. La capa de obligaciones es la brecha mayor. Necesitamos que The Hive confirme las fuentes oficiales a curar (SAT y DOF, STPS e IMSS, Secretaría de Economía, INM, ANAM) y designe a quién de The Hive revisa las unidades curadas por área (legal, fiscal, laboral, aduanas, logística). Con eso preparamos las unidades y las ingerimos como material curado que remite a la fuente oficial.
4. Confirmar si V1 se queda solo con México. Para cualquier otro país, Precision hoy reconoce el límite y registra la demanda; la demanda observada dirá qué país conviene sembrar después.
