FROM ros:humble-ros-base-jammy

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# The repo-root build context also includes tools/mock_vehicle.py.
COPY backend/requirements.txt .

# Install Python dependencies
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY tools/mock_vehicle.py ./tools/mock_vehicle.py

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
