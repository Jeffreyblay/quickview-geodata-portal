class Settings:
    APP_NAME = "GeoData Portal API"
    VERSION = "1.0.0"
    CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
    MAX_UPLOAD_MB = 50
    TEMP_DIR = "/tmp/geodata_portal"


settings = Settings()