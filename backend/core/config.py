from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    app_name: str = "SmartAttend"
    debug: bool = False
    frontend_url: str = "http://localhost:3000"

    database_url: str

    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    embedding_encryption_key: str

    # ── Add these ──────────────────────────
    supabase_url: str = ""
    supabase_key: str = ""
    # ──────────────────────────────────────

    allowed_subnets: str = "0.0.0.0/0"   # open for local testing

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    sendgrid_api_key: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"              # ← ignore any unknown keys in .env


@lru_cache
def get_settings() -> Settings:
    return Settings()