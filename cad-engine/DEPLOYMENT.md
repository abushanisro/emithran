# CAD Engine Railway Deployment Guide

## Overview
The CAD Engine is a Python FastAPI service that provides STEP to STL conversion using OpenCascade Technology (OCCT). This guide covers deployment to Railway.

## Architecture
- **Language**: Python 3.11
- **Framework**: FastAPI
- **CAD Engine**: OpenCascade Technology (pythonocc-core 7.7.2)
- **Container**: Docker with Conda environment
- **Platform**: Railway

## Railway Deployment

### 1. Prerequisites
- Railway account
- Github repository connected to Railway
- Railway CLI (optional, for local management)

### 2. Create Railway Service

**Option A: Using Railway Dashboard**
1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Choose "Add Service" → "GitHub Repo"
5. Set deployment settings:
   - **Root Directory**: `cad-engine`
   - **Build Command**: (Auto-detected from Dockerfile)
   - **Start Command**: `conda run --no-capture-output -n cad-env python main.py`

**Option B: Using Railway CLI**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link project
railway login
railway link

# Deploy CAD engine
cd cad-engine
railway up
```

### 3. Environment Variables

Set these in Railway Dashboard → Settings → Variables:

```bash
PORT=5000
NODE_ENV=production
PYTHONUNBUFFERED=1
CORS_ORIGINS=https://mithran-six.vercel.app,https://mithran-production.up.railway.app
MAX_FILE_SIZE_MB=50
RATE_LIMIT_PER_MINUTE=10
LINEAR_DEFLECTION=0.1
ANGULAR_DEFLECTION=0.5
LOG_LEVEL=info
```

### 4. Domain Configuration

1. Railway will auto-generate a domain like `https://cad-engine-production-xxxx.up.railway.app`
2. Optional: Set custom domain in Railway Dashboard → Settings → Networking

### 5. Health Check

Railway will automatically use the health check configuration from `railway.json`:
- **Health Check Path**: `/health`
- **Timeout**: 300 seconds (allows for OpenCascade initialization)

## API Endpoints

Once deployed, the following endpoints will be available:

- `GET /` - Service info
- `GET /health` - Detailed health check
- `POST /convert/step-to-stl` - Convert STEP to STL (binary)
- `POST /convert/step-to-stl-base64` - Convert STEP to STL (base64)

## Integration with Backend

Update your backend to use the deployed CAD engine URL:

```typescript
// In backend configuration
const CAD_ENGINE_URL = 'https://your-cad-engine-production.up.railway.app'
```

## Performance Considerations

### Resource Limits
- **Memory**: ~1GB required for OpenCascade + Python
- **CPU**: 1-2 vCPUs recommended for mesh generation
- **Disk**: Minimal, temp files are cleaned automatically

### File Size Limits
- Default: 50MB max file size
- Configurable via `MAX_FILE_SIZE_MB` environment variable
- Railway has a 32GB disk limit per service

### Rate Limiting
- Default: 10 requests/minute per IP
- Configurable via `RATE_LIMIT_PER_MINUTE`
- Consider upgrading Railway plan for higher limits

## Monitoring & Logs

### Viewing Logs
```bash
# Using Railway CLI
railway logs

# Or view in Railway Dashboard → Deployments → View Logs
```

### Health Monitoring
- Health endpoint: `/health`
- Returns OpenCascade version and capabilities
- Includes conversion settings and limits

### Key Metrics to Monitor
- Response times (STEP parsing can be slow for large files)
- Memory usage (spikes during mesh generation)
- Disk usage (temp files, should auto-cleanup)
- Rate limit hits

## Security Features

### File Validation
- File extension validation (`.step`, `.stp`, `.iges`, `.igs`)
- Magic number validation for file type verification
- File size limits

### Rate Limiting
- Per-IP rate limiting using SlowAPI
- Configurable limits via environment variables

### CORS Protection
- Whitelist specific origins
- Production URLs configured in `CORS_ORIGINS`

## Troubleshooting

### Common Issues

**1. OpenCascade Import Errors**
```
ModuleNotFoundError: No module named 'OCC'
```
- Ensure Conda environment is properly activated
- Check pythonocc-core installation

**2. Memory Issues**
```
Process killed (OOM)
```
- Reduce `MAX_FILE_SIZE_MB`
- Upgrade Railway plan for more memory

**3. Conversion Timeouts**
```
Health check timeout
```
- Increase `healthcheckTimeout` in railway.json
- Check file complexity (high poly count)

### Debug Mode

For debugging, temporarily set:
```bash
LOG_LEVEL=debug
NODE_ENV=development
```

## Cost Optimization

### Railway Pricing Tiers
- **Hobby**: $5/month - Good for development
- **Pro**: $20/month - Recommended for production
- **Team**: $100/month - For high-volume usage

### Resource Optimization
- Use binary STL format (smaller than ASCII)
- Implement file caching if processing same files repeatedly
- Monitor and optimize mesh quality settings

## Scaling Considerations

### Horizontal Scaling
- Deploy multiple CAD engine instances
- Use load balancer for request distribution
- Consider queue-based processing for large files

### Vertical Scaling
- Upgrade Railway plan for more CPU/memory
- Optimize mesh generation parameters
- Consider GPU-accelerated geometry processing

## Backup & Recovery

### Code Backup
- Repository is backed up in GitHub
- Railway maintains deployment history

### Configuration Backup
- Export environment variables
- Document custom settings
- Keep railway.json in version control

## Support

For deployment issues:
- Railway Documentation: https://docs.railway.app
- OpenCascade Issues: Check pythonocc-core GitHub
- FastAPI Issues: Check FastAPI documentation

---

**Mithran CAD Engine** - Professional STEP to STL conversion service