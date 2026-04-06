from pydantic_settings import BaseSettings
from typing import List

"""
class Settings(BaseSettings):
    APP_NAME: str = "GeoData Portal API"
    VERSION: str = "1.0.0"
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://jeffreyblay.github.io/quickview-geodata-portal/",  # Replace with your GitHub Pages URL
    ]
    MAX_UPLOAD_MB: int = 50
    TEMP_DIR: str = "/tmp/geodata_portal"

    class Config:
        env_file = ".env"


settings = Settings()
""" 

class Settings(BaseSettings):
    APP_NAME: str = "GeoData Portal API"
    VERSION: str = "1.0.0"
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "https://jeffreyblay.github.io",
    ]
    MAX_UPLOAD_MB: int = 50
    TEMP_DIR: str = "/tmp/geodata_portal"

    class Config:
        env_file = None   # Disable .env file loading entirely


settings = Settings()