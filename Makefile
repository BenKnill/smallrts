.PHONY: all build cert install clean serve help

# Default target - build everything
all: install build

# Install npm dependencies
install:
	@echo "Installing dependencies..."
	@npm install

# Build the single HTML file
build: install
	@echo "Building single-file game..."
	@npm run build

# Generate self-signed certificate for current IP
cert:
	@echo "Generating self-signed certificate..."
	@echo "Detecting IP address..."
	@HOST_IP=$$(hostname -I | awk '{print $$1}' || echo "127.0.0.1"); \
	echo "Using IP: $$HOST_IP"; \
	echo "[req]" > openssl.cnf; \
	echo "default_bits       = 2048" >> openssl.cnf; \
	echo "prompt             = no" >> openssl.cnf; \
	echo "default_md         = sha256" >> openssl.cnf; \
	echo "distinguished_name = dn" >> openssl.cnf; \
	echo "x509_extensions    = v3_req" >> openssl.cnf; \
	echo "" >> openssl.cnf; \
	echo "[dn]" >> openssl.cnf; \
	echo "CN = $$HOST_IP" >> openssl.cnf; \
	echo "" >> openssl.cnf; \
	echo "[v3_req]" >> openssl.cnf; \
	echo "subjectAltName = @alt_names" >> openssl.cnf; \
	echo "" >> openssl.cnf; \
	echo "[alt_names]" >> openssl.cnf; \
	echo "IP.1 = $$HOST_IP" >> openssl.cnf; \
	echo "IP.2 = 127.0.0.1" >> openssl.cnf; \
	openssl req -x509 -newkey rsa:2048 -nodes \
		-keyout key.pem -out cert.pem -days 365 -config openssl.cnf
	@echo "Certificate generated for $$HOST_IP"
	@rm openssl.cnf

# Start the HTTPS/WSS server
serve: cert build
	@echo "Starting server on port 8443..."
	@HOST_IP=$$(hostname -I | awk '{print $$1}' || echo "127.0.0.1"); \
	echo ""; \
	echo "Server starting at https://$$HOST_IP:8443"; \
	echo ""; \
	echo "To play:"; \
	echo "  1. Open https://$$HOST_IP:8443 in Firefox"; \
	echo "  2. Accept the security warning (self-signed cert)"; \
	echo "  3. Click 'Host Game' to create a room"; \
	echo "  4. Share the link with friends!"; \
	echo ""; \
	npm run serve

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -f index.html key.pem cert.pem openssl.cnf
	@rm -rf node_modules

# Show help
help:
	@echo "SmallRTS - Single-file WebRTC RTS Game"
	@echo ""
	@echo "Available commands:"
	@echo "  make          - Install dependencies and build"
	@echo "  make build    - Build the single HTML file"
	@echo "  make cert     - Generate self-signed SSL certificate"
	@echo "  make serve    - Build and start the server"
	@echo "  make clean    - Remove build artifacts"
	@echo "  make help     - Show this help message"
	@echo ""
	@echo "Quick start:"
	@echo "  make serve    - Build and run everything"
