"""S3/MinIO storage adapter — reads recording bytes by key for the real adapter.

The mock transcription adapter never touches S3, so this is only exercised by the
real adapter path (never in CI). Credentials come from SettingsSchema's flat
S3_* fields (same names as web's @repo/storage).
"""

from dataclasses import dataclass

import aioboto3

from agents.apps.agent.errors import InvalidPayloadError


@dataclass
class S3StorageRepository:
    endpoint: str | None
    region: str
    access_key: str | None
    secret_key: str | None
    bucket: str | None

    async def get_bytes(self, key: str) -> bytes:
        """Fetch the object bytes for `key` from the configured bucket."""
        if not self.bucket:
            raise InvalidPayloadError('S3_BUCKET is not configured; cannot read the recording')
        session = aioboto3.Session()
        async with session.client(
            's3',
            endpoint_url=self.endpoint,
            region_name=self.region,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        ) as client:
            response = await client.get_object(Bucket=self.bucket, Key=key)
            async with response['Body'] as body:
                data = await body.read()
                return bytes(data)
