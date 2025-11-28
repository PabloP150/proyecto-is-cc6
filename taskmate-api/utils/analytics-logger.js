const fs = require('fs');
const path = require('path');

/**
 * Analytics Logger and Monitoring System
 * Implements proper logging and monitoring for analytics operations
 * Requirement 7.4: Implement proper logging and monitoring
 */
class AnalyticsLogger {
    
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
        this.ensureLogDirectory();
        this.metrics = {
            requests: 0,
            errors: 0,
            responseTime: [],
            lastReset: Date.now()
        };
    }
    
    /**
     * Ensure log directory exists
     */
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    /**
     * Log analytics operations with structured data
     */
    logOperation(operation, data, duration = null, error = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            operation,
            data: this.sanitizeLogData(data),
            duration,
            error: error ? error.message : null,
            level: error ? 'ERROR' : 'INFO'
        };
        
        // Update metrics
        this.updateMetrics(operation, duration, error);
        
        // Write to log file
        this.writeToLogFile('analytics-operations.log', logEntry);
        
        // Console output for development
        if (process.env.NODE_ENV !== 'production') {
            this.consoleLog(logEntry);
        }
        
        // Alert on errors
        if (error) {
            this.handleError(operation, error, data);
        }
    }
    
    /**
     * Log API access for audit purposes
     */
    logAPIAccess(req, res, responseTime) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            userId: req.analytics?.requesterId || 'anonymous',
            statusCode: res.statusCode,
            responseTime,
            level: res.statusCode >= 400 ? 'WARN' : 'INFO'
        };
        
        this.writeToLogFile('analytics-access.log', logEntry);
        
        // Track API metrics
        this.updateAPIMetrics(req, res, responseTime);
    }
    
    /**
     * Log performance metrics
     */
    logPerformance(operation, metrics) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            operation,
            metrics: {
                duration: metrics.duration,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
                ...metrics
            },
            level: 'PERFORMANCE'
        };
        
        this.writeToLogFile('analytics-performance.log', logEntry);
        
        // Alert on performance issues
        if (metrics.duration > 5000) { // 5 seconds
            this.logOperation('PERFORMANCE_ALERT', {\n                operation,\n                duration: metrics.duration,\n                threshold: 5000\n            }, null, new Error('Operation exceeded performance threshold'));\n        }\n    }\n    \n    /**\n     * Log security events\n     */\n    logSecurity(event, details) {\n        const logEntry = {\n            timestamp: new Date().toISOString(),\n            event,\n            details: this.sanitizeLogData(details),\n            level: 'SECURITY',\n            severity: this.getSecuritySeverity(event)\n        };\n        \n        this.writeToLogFile('analytics-security.log', logEntry);\n        \n        // Alert on high severity security events\n        if (logEntry.severity === 'HIGH') {\n            this.alertSecurityEvent(logEntry);\n        }\n    }\n    \n    /**\n     * Get current system metrics\n     */\n    getMetrics() {\n        const now = Date.now();\n        const timeSinceReset = now - this.metrics.lastReset;\n        const hoursElapsed = timeSinceReset / (1000 * 60 * 60);\n        \n        return {\n            requests: this.metrics.requests,\n            errors: this.metrics.errors,\n            errorRate: this.metrics.requests > 0 ? (this.metrics.errors / this.metrics.requests) * 100 : 0,\n            avgResponseTime: this.metrics.responseTime.length > 0 \n                ? this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length \n                : 0,\n            requestsPerHour: hoursElapsed > 0 ? this.metrics.requests / hoursElapsed : 0,\n            uptime: timeSinceReset,\n            memoryUsage: process.memoryUsage(),\n            lastReset: new Date(this.metrics.lastReset).toISOString()\n        };\n    }\n    \n    /**\n     * Reset metrics (useful for periodic reporting)\n     */\n    resetMetrics() {\n        this.metrics = {\n            requests: 0,\n            errors: 0,\n            responseTime: [],\n            lastReset: Date.now()\n        };\n        \n        this.logOperation('METRICS_RESET', { timestamp: new Date().toISOString() });\n    }\n    \n    /**\n     * Generate health report\n     */\n    generateHealthReport() {\n        const metrics = this.getMetrics();\n        const health = {\n            status: 'healthy',\n            timestamp: new Date().toISOString(),\n            metrics,\n            checks: {\n                errorRate: metrics.errorRate < 5, // Less than 5% error rate\n                responseTime: metrics.avgResponseTime < 2000, // Less than 2 seconds\n                memoryUsage: metrics.memoryUsage.heapUsed < 500 * 1024 * 1024 // Less than 500MB\n            }\n        };\n        \n        // Determine overall health status\n        const failedChecks = Object.values(health.checks).filter(check => !check).length;\n        if (failedChecks > 0) {\n            health.status = failedChecks > 1 ? 'unhealthy' : 'degraded';\n        }\n        \n        this.writeToLogFile('analytics-health.log', health);\n        \n        return health;\n    }\n    \n    // Private helper methods\n    \n    /**\n     * Sanitize sensitive data from logs\n     */\n    sanitizeLogData(data) {\n        if (!data || typeof data !== 'object') {\n            return data;\n        }\n        \n        const sanitized = { ...data };\n        const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];\n        \n        for (const field of sensitiveFields) {\n            if (sanitized[field]) {\n                sanitized[field] = '[REDACTED]';\n            }\n        }\n        \n        return sanitized;\n    }\n    \n    /**\n     * Update operation metrics\n     */\n    updateMetrics(operation, duration, error) {\n        this.metrics.requests++;\n        \n        if (error) {\n            this.metrics.errors++;\n        }\n        \n        if (duration !== null) {\n            this.metrics.responseTime.push(duration);\n            \n            // Keep only last 1000 response times to prevent memory issues\n            if (this.metrics.responseTime.length > 1000) {\n                this.metrics.responseTime = this.metrics.responseTime.slice(-1000);\n            }\n        }\n    }\n    \n    /**\n     * Update API-specific metrics\n     */\n    updateAPIMetrics(req, res, responseTime) {\n        // Track API endpoint usage\n        const endpoint = `${req.method} ${req.route?.path || req.originalUrl}`;\n        \n        if (!this.apiMetrics) {\n            this.apiMetrics = {};\n        }\n        \n        if (!this.apiMetrics[endpoint]) {\n            this.apiMetrics[endpoint] = {\n                requests: 0,\n                errors: 0,\n                totalResponseTime: 0\n            };\n        }\n        \n        this.apiMetrics[endpoint].requests++;\n        this.apiMetrics[endpoint].totalResponseTime += responseTime;\n        \n        if (res.statusCode >= 400) {\n            this.apiMetrics[endpoint].errors++;\n        }\n    }\n    \n    /**\n     * Write log entry to file\n     */\n    writeToLogFile(filename, logEntry) {\n        const logPath = path.join(this.logDir, filename);\n        const logLine = JSON.stringify(logEntry) + '\\n';\n        \n        try {\n            fs.appendFileSync(logPath, logLine);\n        } catch (error) {\n            console.error('Failed to write to log file:', error);\n        }\n    }\n    \n    /**\n     * Console logging for development\n     */\n    consoleLog(logEntry) {\n        const color = this.getLogColor(logEntry.level);\n        const message = `${color}[${logEntry.timestamp}] ${logEntry.level}: ${logEntry.operation}${this.resetColor()}`;\n        \n        if (logEntry.error) {\n            console.error(message, logEntry.error);\n        } else {\n            console.log(message);\n        }\n    }\n    \n    /**\n     * Get console color for log level\n     */\n    getLogColor(level) {\n        const colors = {\n            INFO: '\\x1b[36m',    // Cyan\n            WARN: '\\x1b[33m',    // Yellow\n            ERROR: '\\x1b[31m',   // Red\n            SECURITY: '\\x1b[35m', // Magenta\n            PERFORMANCE: '\\x1b[32m' // Green\n        };\n        return colors[level] || '\\x1b[0m';\n    }\n    \n    /**\n     * Reset console color\n     */\n    resetColor() {\n        return '\\x1b[0m';\n    }\n    \n    /**\n     * Handle error logging and alerting\n     */\n    handleError(operation, error, data) {\n        // Log detailed error information\n        const errorDetails = {\n            operation,\n            error: {\n                message: error.message,\n                stack: error.stack,\n                code: error.code\n            },\n            data: this.sanitizeLogData(data),\n            timestamp: new Date().toISOString()\n        };\n        \n        this.writeToLogFile('analytics-errors.log', errorDetails);\n        \n        // Alert on critical errors\n        if (this.isCriticalError(error)) {\n            this.alertCriticalError(errorDetails);\n        }\n    }\n    \n    /**\n     * Determine if error is critical\n     */\n    isCriticalError(error) {\n        const criticalPatterns = [\n            'database connection',\n            'authentication failed',\n            'permission denied',\n            'out of memory'\n        ];\n        \n        return criticalPatterns.some(pattern => \n            error.message.toLowerCase().includes(pattern)\n        );\n    }\n    \n    /**\n     * Get security event severity\n     */\n    getSecuritySeverity(event) {\n        const highSeverityEvents = [\n            'UNAUTHORIZED_ACCESS',\n            'PRIVILEGE_ESCALATION',\n            'DATA_BREACH',\n            'INJECTION_ATTEMPT'\n        ];\n        \n        return highSeverityEvents.includes(event) ? 'HIGH' : 'MEDIUM';\n    }\n    \n    /**\n     * Alert on critical errors (placeholder for notification system)\n     */\n    alertCriticalError(errorDetails) {\n        console.error('🚨 CRITICAL ERROR ALERT:', errorDetails.operation);\n        // In production, this would send alerts via email, Slack, etc.\n    }\n    \n    /**\n     * Alert on security events (placeholder for security monitoring)\n     */\n    alertSecurityEvent(logEntry) {\n        console.warn('🔒 SECURITY ALERT:', logEntry.event);\n        // In production, this would trigger security monitoring systems\n    }\n}\n\n// Create singleton instance\nconst analyticsLogger = new AnalyticsLogger();\n\n// Express middleware for automatic API logging\nconst loggerMiddleware = (req, res, next) => {\n    const startTime = Date.now();\n    \n    // Override res.end to capture response time\n    const originalEnd = res.end;\n    res.end = function(...args) {\n        const responseTime = Date.now() - startTime;\n        analyticsLogger.logAPIAccess(req, res, responseTime);\n        originalEnd.apply(this, args);\n    };\n    \n    next();\n};\n\n// Performance monitoring decorator\nconst monitorPerformance = (operation) => {\n    return (target, propertyName, descriptor) => {\n        const method = descriptor.value;\n        \n        descriptor.value = async function(...args) {\n            const startTime = Date.now();\n            const startMemory = process.memoryUsage();\n            \n            try {\n                const result = await method.apply(this, args);\n                const duration = Date.now() - startTime;\n                const endMemory = process.memoryUsage();\n                \n                analyticsLogger.logPerformance(operation, {\n                    duration,\n                    memoryDelta: endMemory.heapUsed - startMemory.heapUsed,\n                    success: true\n                });\n                \n                return result;\n            } catch (error) {\n                const duration = Date.now() - startTime;\n                \n                analyticsLogger.logPerformance(operation, {\n                    duration,\n                    success: false,\n                    error: error.message\n                });\n                \n                throw error;\n            }\n        };\n        \n        return descriptor;\n    };\n};\n\nmodule.exports = {\n    AnalyticsLogger,\n    analyticsLogger,\n    loggerMiddleware,\n    monitorPerformance\n};"