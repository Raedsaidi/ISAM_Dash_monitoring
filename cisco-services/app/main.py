from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import cisco
from app.core.config import settings

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cisco.router, prefix="/api/cisco", tags=["Cisco"])


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": settings.APP_NAME}