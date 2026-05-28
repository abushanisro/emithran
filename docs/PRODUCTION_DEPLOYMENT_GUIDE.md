# MITHRAN MANUFACTURING ERP - PRODUCTION DEPLOYMENT GUIDE

## CRITICAL SECURITY NOTICE
Your original production credentials were **REMOVED** from the repository for security. You must:
1. **Rotate all Supabase credentials immediately**
2. Use environment variables or secret management for production
3. Never commit `.env.production` files to git

## DEPLOYMENT CHECKLIST

### 1. DATABASE SETUP (CRITICAL - DO FIRST)

#### Supabase Production Setup:
```bash
# 1. Create new Supabase project for production (separate from development)
# 2. Run the consolidated migration:
psql -h db.your-project.supabase.co -U postgres -d postgres < backend/database/migrations/000_consolidated_production_schema.sql

# 3. Apply production configuration:
psql -h db.your-project.supabase.co -U postgres -d postgres < backend/database/production-config.sql

# 4. Verify migration success:
psql -h db.your-project.supabase.co -U postgres -d postgres -c "SELECT version FROM schema_migrations;"
```

### 2. ENVIRONMENT CONFIGURATION

#### Production Environment Variables:
Copy `.env.production.template` and configure:

**Required Variables:**
```bash
# Application
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Supabase (NEW credentials after rotation)
SUPABASE_URL=https://your-new-project.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://your-new-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_anon_key
SUPABASE_SERVICE_KEY=your_new_service_key

# Security
JWT_SECRET=your_256bit_secret_key
CORS_ORIGIN=https://your-domain.com

# API Configuration
NEXT_PUBLIC_API_GATEWAY_URL=https://api.your-domain.com
```

### 3. SECURITY HARDENING

#### SSL/TLS Setup:
- Configure HTTPS certificates
- Enable HSTS headers (already configured in middleware)
- Set up CDN with DDoS protection (Cloudflare recommended)

#### Database Security:
- Enable SSL connections only
- Configure connection pooling (max 100 connections)
- Set up database firewall rules
- Enable audit logging

### 4. DEPLOYMENT OPTIONS

#### Option A: Docker Deployment (Recommended)
```bash
# Build and deploy with Docker Compose
docker-compose -f docker-compose.yml up -d --build

# Verify all services are healthy
docker-compose ps
```

#### Option B: Vercel Deployment (Frontend + Serverless)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy frontend
vercel --prod

# Set environment variables in Vercel dashboard
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
# ... add all required env vars
```

#### Option C: AWS/Azure/GCP Deployment
- Use containerized deployment with auto-scaling
- Configure load balancer with health checks
- Set up managed database (RDS/Azure SQL/Cloud SQL)
- Configure file storage (S3/Azure Blob/Cloud Storage)

### 5. PERFORMANCE OPTIMIZATION

#### CDN Configuration:
```javascript
// Set these headers at CDN level:
Cache-Control: public, max-age=31536000, immutable  // for static assets
Cache-Control: no-cache, no-store, must-revalidate  // for dynamic content
```

#### Database Performance:
- Connection pooling with PgBouncer
- Read replicas for reporting
- Regular VACUUM and ANALYZE
- Monitor slow queries with pg_stat_statements

### 6. MONITORING SETUP

#### Essential Monitoring:
```bash
# Database performance
SELECT * FROM monitoring.slow_queries LIMIT 10;

# System health check
SELECT * FROM monitoring.system_health_check();

# Active connections
SELECT * FROM monitoring.active_connections;
```

#### Application Monitoring:
- Set up error tracking (Sentry recommended)
- Configure uptime monitoring
- Set up performance monitoring
- Enable log aggregation

### 7. BACKUP STRATEGY

#### Database Backups:
```bash
# Daily automated backups
pg_dump -h your-host -U postgres -d your-db > backup_$(date +%Y%m%d).sql

# Point-in-time recovery setup
# Configure WAL archiving for continuous backup
```

#### Application Backups:
- File uploads backup to S3/cloud storage
- Environment configuration backup (encrypted)
- Infrastructure as code backup

### 8. SECURITY MONITORING

#### Log Monitoring:
- Monitor authentication failures
- Track API rate limiting violations
- Alert on unusual database queries
- Monitor file upload patterns

#### Security Headers Verification:
```bash
curl -I https://your-domain.com | grep -E "(Content-Security-Policy|X-Frame-Options|Strict-Transport-Security)"
```

## PRODUCTION READY FEATURES IMPLEMENTED

### ✅ Security
- [x] Removed exposed production credentials
- [x] Production-ready CSP with nonce support
- [x] Comprehensive security headers
- [x] SQL injection protection with prepared statements
- [x] Rate limiting configuration
- [x] HSTS enforcement in production
- [x] XSS protection headers

### ✅ Database
- [x] Consolidated production-ready schema
- [x] Performance-optimized indexes
- [x] Row Level Security (RLS) policies
- [x] Materialized views for reporting
- [x] Database monitoring views
- [x] Connection pooling configuration
- [x] Backup and recovery procedures

### ✅ Performance
- [x] Image optimization configuration
- [x] Font optimization with next/font
- [x] Bundle size optimization
- [x] CDN-ready cache headers
- [x] Compression enabled
- [x] Tree-shaking optimized imports

### ✅ Monitoring
- [x] Request tracing with unique IDs
- [x] Performance timing headers
- [x] Database query monitoring
- [x] Health check endpoints
- [x] Error boundary implementation
- [x] Logging configuration

### ✅ SEO & Meta
- [x] Proper robots.txt configuration
- [x] Dynamic sitemap generation
- [x] Open Graph meta tags
- [x] Twitter Card support
- [x] Structured metadata

## COST OPTIMIZATION

### Expected Infrastructure Costs (Monthly):
- **Small Deployment**: $50-100/month
  - Vercel Hobby + Supabase Pro
  - 1-10 users, basic features
  
- **Medium Deployment**: $200-500/month
  - Vercel Pro + Supabase Pro + CDN
  - 10-100 users, full features
  
- **Enterprise Deployment**: $1000+/month
  - Dedicated infrastructure + monitoring
  - 100+ users, high availability

## PERFORMANCE TARGETS

### Expected Performance:
- **First Contentful Paint**: < 1.5s
- **Largest Contentful Paint**: < 2.5s
- **Time to Interactive**: < 3.0s
- **Database Query Time**: < 100ms (95th percentile)
- **API Response Time**: < 200ms (95th percentile)

## SUPPORT & MAINTENANCE

### Regular Maintenance Tasks:
- **Daily**: Monitor error rates and performance
- **Weekly**: Review slow queries and optimize
- **Monthly**: Update dependencies and security patches
- **Quarterly**: Performance review and scaling assessment

### Critical Alerts Setup:
- Database connection failures
- API error rate > 5%
- Response time > 5 seconds
- Disk usage > 80%
- Memory usage > 90%

## ROLLBACK PLAN

In case of deployment issues:
1. Revert to previous Docker image/deployment
2. Restore database from latest backup if needed
3. Switch DNS back to previous version
4. Verify all services are operational

---

**IMPORTANT**: Test all configurations in a staging environment before production deployment.

**SECURITY REMINDER**: The original production credentials found in your repository have been removed. You MUST rotate all Supabase credentials before deployment.