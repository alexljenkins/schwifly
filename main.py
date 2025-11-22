# Copyright Alex Jenkins 2025
# Run using: uvicorn main:app --reload
import uvicorn
import os

from schwifly.api import app

if __name__ == "__main__":
    os.environ["ANONYMIZED_TELEMETRY"] = "false"
    uvicorn.run(app, host="0.0.0.0", port=8000)
