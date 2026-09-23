import hashlib
import hmac


def sign(raw_body: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()


def verify(raw_body: bytes, signature: str, secret: str) -> bool:
    if not signature:
        return False
    return hmac.compare_digest(sign(raw_body, secret), signature)
