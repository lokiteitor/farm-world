# Farming Management Simulator Online — command entry point.
#
# Frozen after workflow W1 (plan section 11, rule 2): agents invoke targets, they
# never write them. This is also the only place where the four independent npm
# projects (., shared/, backend/, frontend/) are coordinated as a single
# workflow, which is what replaces workspaces (stack section 7.4).
#
# `sync-types` is a prerequisite of dev, build, test and lint, because shared/ is
# the single source of truth and the copies under backend/src/shared and
# frontend/app/shared are generated (plan section 4).

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE      := docker compose -f docker-compose.yml
COMPOSE_PROD := docker compose -f docker-compose.prod.yml
COMPOSE_OBS  := docker compose -f docker-compose.yml -f docker-compose.obs.yml
NPM_PROJECTS := . shared backend frontend

.PHONY: help install bootstrap sync-types check-sync dev up down build logs ps \
        typecheck lint format test test-unit test-int migrate migrate-dev reset \
        seed generate balance smoke smoke-ui verify perf-lab clean backup \
        deploy adr obs-up obs-down compose-config

# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

help: ## Lista los targets disponibles con su descripcion
	@echo "Farming Management Simulator Online"
	@echo ""
	@echo "Uso: make <target>"
	@echo ""
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ---------------------------------------------------------------------------
# Dependencies and shared types
# ---------------------------------------------------------------------------

install: ## Instala dependencias de los cuatro proyectos npm (raiz, shared, backend, frontend)
	@for d in $(NPM_PROJECTS); do \
		echo "--> npm install en $$d"; \
		if [ -f "$$d/package-lock.json" ]; then \
			( cd "$$d" && npm ci ) || exit 1; \
		else \
			( cd "$$d" && npm install ) || exit 1; \
		fi; \
	done

bootstrap: ## Prepara un entorno nuevo: .env, dependencias y copias de shared/
	@if [ ! -f .env ]; then cp .env.example .env; echo "--> .env creado desde .env.example"; \
		else echo "--> .env ya existe, no se sobrescribe"; fi
	@$(MAKE) install
	@$(MAKE) sync-types
	@echo "--> Listo. Siguiente paso: make up && make migrate && make seed"

sync-types: ## Copia shared/ a backend/src/shared y frontend/app/shared
	@bash scripts/sync-shared-types.sh

check-sync: ## Falla si alguna copia de shared/ difiere del origen
	@bash scripts/check-shared-sync.sh

# ---------------------------------------------------------------------------
# Development stack
# ---------------------------------------------------------------------------

dev: sync-types ## Levanta la pila de desarrollo en primer plano con logs
	@$(COMPOSE) up

up: sync-types ## Levanta la pila de desarrollo en segundo plano
	@$(COMPOSE) up -d
	@$(MAKE) ps

down: ## Detiene la pila de desarrollo conservando los volumenes
	@$(COMPOSE) down

build: sync-types ## Reconstruye las imagenes de desarrollo
	@$(COMPOSE) build

logs: ## Sigue los logs de backend y worker
	@$(COMPOSE) logs -f backend worker

ps: ## Muestra el estado de los servicios
	@$(COMPOSE) ps

obs-up: ## Levanta Prometheus y Grafana (perfil obs)
	@$(COMPOSE_OBS) --profile obs up -d prometheus grafana

obs-down: ## Detiene Prometheus y Grafana
	@$(COMPOSE_OBS) --profile obs stop prometheus grafana

compose-config: ## Valida la sintaxis de los tres ficheros de Compose
	@$(COMPOSE) config -q
	@POSTGRES_PASSWORD=validate JWT_SECRET=validate $(COMPOSE_PROD) config -q
	@$(COMPOSE_OBS) config -q
	@echo "--> Los tres ficheros de Compose son validos"

# ---------------------------------------------------------------------------
# Static analysis
# ---------------------------------------------------------------------------

typecheck: sync-types ## Comprueba tipos en shared, backend y frontend
	@echo "--> shared"
	@cd shared && npx tsc --noEmit
	@echo "--> backend"
	@cd backend && npx tsc --noEmit
	@echo "--> frontend"
	@cd frontend && npm run --silent typecheck

lint: sync-types ## ESLint sobre todo el repositorio, incluidas las reglas de zona
	@npx eslint .
	@npx prettier --check .

format: ## Aplica Prettier y las correcciones automaticas de ESLint
	@npx prettier --write .
	@npx eslint . --fix

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

test: test-unit test-int ## Ejecuta las pruebas unitarias y de integracion

test-unit: sync-types ## Pruebas unitarias de shared y frontend
	@echo "--> shared"
	@cd shared && npm run --silent test
	@echo "--> frontend"
	@cd frontend && npm run --silent test

test-int: sync-types ## Pruebas de integracion del backend con Postgres y Redis reales
	@cd backend && npm run --silent test:int

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

migrate: ## Aplica las migraciones pendientes (deploy, sin generar migraciones)
	@cd backend && npx prisma migrate deploy

migrate-dev: ## Crea y aplica una migracion de desarrollo: make migrate-dev NAME=descripcion
	@if [ -z "$(NAME)" ]; then echo "Falta NAME. Uso: make migrate-dev NAME=add_forest_plot"; exit 1; fi
	@cd backend && npx prisma migrate dev --name "$(NAME)"

reset: sync-types ## Destruye y recrea la base de datos de desarrollo, y la puebla
	@cd backend && npx prisma migrate reset --force
	@$(MAKE) seed

# `sync-types` es prerrequisito porque seed.ts importa las constantes de
# backend/src/shared, que es la copia sincronizada: la regla de zonas de ESLint
# prohibe al backend importar shared/ de la raiz. Sin la copia al dia, un arbol
# recien clonado falla con «does not provide an export named CHUNK_SIZE»
# (docs/handoff/NOTES-w2d.md, apartado 9).
seed: sync-types ## Puebla el mundo inicial y los datos de arranque
	@cd backend && npm run --silent seed

generate: ## Regenera el cliente de Prisma
	@cd backend && npx prisma generate

# ---------------------------------------------------------------------------
# Verification and tooling
# ---------------------------------------------------------------------------

balance: ## Genera el informe de KPIs de balance en docs/balance/
	@mkdir -p docs/balance
	@if [ ! -f tools/balance/index.ts ]; then \
		echo "tools/balance/index.ts no existe todavia (propietario: W6-E, ver docs/ownership.md)"; \
		exit 1; \
	fi
	@cd backend && npx tsx ../tools/balance/index.ts

smoke: ## Recorre el bucle completo por HTTP contra la pila real
	@if [ ! -f scripts/smoke/smoke.ts ]; then \
		echo "scripts/smoke/smoke.ts no existe todavia (propietario: W7-A, ver docs/ownership.md)"; \
		exit 1; \
	fi
	@$(COMPOSE) up -d --wait
	@cd backend && npx tsx ../scripts/smoke/smoke.ts

smoke-ui: ## Comprobacion manual guiada del cliente en el navegador
	@echo "Pila de desarrollo:"
	@echo "  Cliente (dev server) : http://localhost:$${FRONTEND_DEV_PORT:-3100}"
	@echo "  Cliente (via Caddy)  : http://localhost:$${HTTP_PORT:-8080}"
	@echo "  API                  : http://localhost:$${BACKEND_PORT:-3000}/api"
	@echo "  OpenAPI              : http://localhost:$${BACKEND_PORT:-3000}/docs"
	@echo "  Metricas             : http://localhost:$${BACKEND_PORT:-3000}/metrics"
	@echo ""
	@echo "Secuencia de comprobacion (plan seccion 12.6):"
	@echo "  1. Registro y login"
	@echo "  2. Desplazamiento y zoom, con carga y descarga de chunks"
	@echo "  3. Compra de tierra por arrastre"
	@echo "  4. Construccion de granja y colocacion de edificio"
	@echo "  5. Asignacion de tarea y llegada del evento de fin por WebSocket sin recargar"
	@echo "  6. Presupuesto de rendimiento en la ruta de medicion (make perf-lab)"

verify: ## Puerta unica: sincronizacion, lint, tipos, pruebas y smoke
	@$(MAKE) check-sync
	@$(MAKE) lint
	@$(MAKE) typecheck
	@$(MAKE) test-unit
	@$(MAKE) test-int
	@$(MAKE) compose-config
	@$(MAKE) smoke
	@echo "--> verify completo"

perf-lab: ## Abre la ruta de medicion de fotogramas y draw calls del cliente
	@echo "Ruta de medicion: http://localhost:$${FRONTEND_DEV_PORT:-3100}/perf"
	@echo "Presupuesto (plan seccion 9.3): ~110 draw calls y ~8.000 cuadrilateros a zoom 1"

adr: ## Anade una entrada a docs/adr.md: make adr FILE=entrada.md
	@if [ -z "$(FILE)" ]; then \
		echo "Falta FILE. Uso: make adr FILE=docs/handoff/adr-0006.md"; \
		echo "Tambien acepta entrada por stdin: node scripts/adr-append.mjs < entrada.md"; \
		exit 1; \
	fi
	@node scripts/adr-append.mjs --file "$(FILE)"

# ---------------------------------------------------------------------------
# Maintenance and deployment
# ---------------------------------------------------------------------------

clean: ## Borra dependencias, salidas de compilacion y copias generadas de shared/
	@rm -rf node_modules shared/node_modules backend/node_modules frontend/node_modules
	@rm -rf backend/dist frontend/.nuxt frontend/.output
	@rm -rf backend/src/shared frontend/app/shared
	@find . -name '*.tsbuildinfo' -not -path './*/node_modules/*' -delete
	@rm -rf shared/coverage backend/coverage frontend/coverage
	@echo "--> Limpio. Los volumenes de Docker no se tocan: usa 'docker compose down -v'"

backup: ## Volcado de PostgreSQL en backups/
	@mkdir -p backups
	@$(COMPOSE) exec -T postgres pg_dump -U "$${POSTGRES_USER:-farmworld}" \
		-d "$${POSTGRES_DB:-farmworld}" --format=custom \
		> "backups/$$(date +%F-%H%M%S).dump"
	@ls -lh backups | tail -1

deploy: ## Construye, publica el estatico y actualiza la pila de produccion
	@$(MAKE) sync-types
	@$(COMPOSE_PROD) build
	@$(COMPOSE_PROD) run --rm frontend-dist
	@$(COMPOSE_PROD) up -d
	@$(COMPOSE_PROD) exec -T backend npx prisma migrate deploy
	@$(COMPOSE_PROD) ps
