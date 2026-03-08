.PHONY: test-frontend test-backend typecheck test-all dev-frontend dev-backend

test-frontend:
	cd frontend && npm test

test-backend:
	cd backend && python3 -m pytest

typecheck:
	cd frontend && npx tsc --noEmit

test-all: test-frontend typecheck test-backend

dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && uvicorn main:app --reload
