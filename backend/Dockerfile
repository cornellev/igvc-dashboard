FROM ros:humble-ros-base-jammy

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    ros-humble-map-msgs \
    ros-humble-nav-msgs \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file (build context is backend/, so path is subscriber/requirements.txt)
COPY requirements.txt .

# Install Python dependencies
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
