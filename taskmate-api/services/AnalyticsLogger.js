const fs = require('fs').promises;
const path = require('path');

/**
 * Analytics Logger Service
 * Implements requirement 7.4: Implement proper logging and monitoring for analytics operations
 */
class AnalyticsLogger {
    
    constructor() {
        this.logDirectory = path.join(__dirname, '../logs');
        this.logLevels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };
        this.currentLogLevel = this.logLevels.INFO;
        this.logRotationSize = 10 * 1024 * 1024; // 10MB
        this.maxLogFiles = 5;
        
        this.initializeLogDirectory();
    }
    
    /**
     * Initialize log directory
     */
    async initializeLogDirectory() {
        try {
            await fs.mkdir(this.logDirectory, { recursive: true });
        } catch (error) {
            console.error('Failed to create log directory:', error.message);
        }
    }
    
    /**
     * Log analytics operation
     */
    async logOperation(level, operation, data, duration = null, error = null) {
        if (this.logLevels[level] > this.currentLogLevel) {
            return; // Skip logging if level is below current threshold
        }
        
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            operation,
            data: this.sanitizeLogData(data),
            duration_ms: duration,
            error: error ? this.sanitizeError(error) : null,
            memory_usage: this.getMemoryUsage(),
            process_id: process.pid
        };
        
        await this.writeLogEntry('analytics', logEntry);
        
        // Also log to console for development
        if (process.env.NODE_ENV !== 'production') {
            this.logToConsole(logEntry);
        }
    }
    
    /**
     * Log performance metrics
     */
    async logPerformance(operation, metrics) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            type: 'performance',
            operation,
            metrics: {
                duration_ms: metrics.duration,
                memory_used_mb: metrics.memoryUsed,
                cpu_usage_percent: metrics.cpuUsage,
                query_count: metrics.queryCount,
                success_rate: metrics.successRate,
                error_count: metrics.errorCount
            },
            thresholds: {
                duration_threshold_ms: metrics.durationThreshold,
                memory_threshold_mb: metrics.memoryThreshold,
                success_rate_threshold: metrics.successRateThreshold
            },
            status: this.determinePerformanceStatus(metrics)
        };
        
        await this.writeLogEntry('performance', logEntry);
    }
    
    /**\n     * Log error with context\n     */\n    async logError(operation, error, context = {}) {\n        const timestamp = new Date().toISOString();\n        const logEntry = {\n            timestamp,\n            level: 'ERROR',\n            operation,\n            error: {\n                message: error.message,\n                stack: error.stack,\n                code: error.code,\n                name: error.name\n            },\n            context: this.sanitizeLogData(context),\n            system_info: {\n                memory_usage: this.getMemoryUsage(),\n                uptime: process.uptime(),\n                platform: process.platform,\n                node_version: process.version\n            }\n        };\n        \n        await this.writeLogEntry('errors', logEntry);\n        \n        // Always log errors to console\n        console.error(`[${timestamp}] Analytics Error in ${operation}:`, error.message);\n        if (context && Object.keys(context).length > 0) {\n            console.error('Context:', context);\n        }\n    }\n    \n    /**\n     * Log analytics health check\n     */\n    async logHealthCheck(status, metrics) {\n        const timestamp = new Date().toISOString();\n        const logEntry = {\n            timestamp,\n            type: 'health_check',\n            status: status.healthy ? 'healthy' : 'unhealthy',\n            metrics: {\n                database_connection: status.database_connection,\n                service_availability: status.service_availability,\n                response_time_ms: metrics.responseTime,\n                active_connections: metrics.activeConnections,\n                memory_usage_mb: metrics.memoryUsage,\n                cpu_usage_percent: metrics.cpuUsage\n            },\n            issues: status.errors || [],\n            recommendations: this.generateHealthRecommendations(status, metrics)\n        };\n        \n        await this.writeLogEntry('health', logEntry);\n        \n        if (!status.healthy) {\n            console.warn(`[${timestamp}] Analytics Health Check Failed:`, status.errors);\n        }\n    }\n    \n    /**\n     * Log user activity for analytics\n     */\n    async logUserActivity(userId, activity, metadata = {}) {\n        const timestamp = new Date().toISOString();\n        const logEntry = {\n            timestamp,\n            type: 'user_activity',\n            user_id: userId,\n            activity,\n            metadata: this.sanitizeLogData(metadata),\n            session_info: {\n                ip_address: metadata.ip_address ? this.hashIP(metadata.ip_address) : null,\n                user_agent: metadata.user_agent ? this.sanitizeUserAgent(metadata.user_agent) : null,\n                request_id: metadata.request_id\n            }\n        };\n        \n        await this.writeLogEntry('user_activity', logEntry);\n    }\n    \n    /**\n     * Log analytics configuration changes\n     */\n    async logConfigurationChange(userId, groupId, oldConfig, newConfig) {\n        const timestamp = new Date().toISOString();\n        const logEntry = {\n            timestamp,\n            type: 'configuration_change',\n            user_id: userId,\n            group_id: groupId,\n            changes: this.calculateConfigChanges(oldConfig, newConfig),\n            old_config: this.sanitizeLogData(oldConfig),\n            new_config: this.sanitizeLogData(newConfig)\n        };\n        \n        await this.writeLogEntry('configuration', logEntry);\n        \n        console.log(`[${timestamp}] Analytics configuration changed for group ${groupId} by user ${userId}`);\n    }\n    \n    /**\n     * Generate analytics report\n     */\n    async generateAnalyticsReport(startDate, endDate) {\n        const report = {\n            period: {\n                start: startDate.toISOString(),\n                end: endDate.toISOString()\n            },\n            summary: await this.generateReportSummary(startDate, endDate),\n            performance: await this.generatePerformanceReport(startDate, endDate),\n            errors: await this.generateErrorReport(startDate, endDate),\n            user_activity: await this.generateUserActivityReport(startDate, endDate),\n            recommendations: await this.generateRecommendations(startDate, endDate)\n        };\n        \n        const reportFilename = `analytics_report_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.json`;\n        await this.writeLogEntry('reports', report, reportFilename);\n        \n        return report;\n    }\n    \n    // Helper methods\n    \n    /**\n     * Sanitize log data to remove sensitive information\n     */\n    sanitizeLogData(data) {\n        if (!data || typeof data !== 'object') {\n            return data;\n        }\n        \n        const sanitized = { ...data };\n        const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential'];\n        \n        for (const field of sensitiveFields) {\n            if (sanitized[field]) {\n                sanitized[field] = '[REDACTED]';\n            }\n        }\n        \n        // Sanitize nested objects\n        Object.keys(sanitized).forEach(key => {\n            if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {\n                sanitized[key] = this.sanitizeLogData(sanitized[key]);\n            }\n        });\n        \n        return sanitized;\n    }\n    \n    /**\n     * Sanitize error objects\n     */\n    sanitizeError(error) {\n        return {\n            message: error.message,\n            name: error.name,\n            code: error.code,\n            stack: process.env.NODE_ENV === 'development' ? error.stack : '[REDACTED]'\n        };\n    }\n    \n    /**\n     * Get current memory usage\n     */\n    getMemoryUsage() {\n        const usage = process.memoryUsage();\n        return {\n            heap_used_mb: Math.round(usage.heapUsed / 1024 / 1024),\n            heap_total_mb: Math.round(usage.heapTotal / 1024 / 1024),\n            external_mb: Math.round(usage.external / 1024 / 1024),\n            rss_mb: Math.round(usage.rss / 1024 / 1024)\n        };\n    }\n    \n    /**\n     * Determine performance status based on metrics\n     */\n    determinePerformanceStatus(metrics) {\n        const issues = [];\n        \n        if (metrics.duration > metrics.durationThreshold) {\n            issues.push('slow_response');\n        }\n        \n        if (metrics.memoryUsed > metrics.memoryThreshold) {\n            issues.push('high_memory_usage');\n        }\n        \n        if (metrics.successRate < metrics.successRateThreshold) {\n            issues.push('low_success_rate');\n        }\n        \n        if (issues.length === 0) {\n            return 'optimal';\n        } else if (issues.length <= 1) {\n            return 'acceptable';\n        } else {\n            return 'needs_attention';\n        }\n    }\n    \n    /**\n     * Generate health recommendations\n     */\n    generateHealthRecommendations(status, metrics) {\n        const recommendations = [];\n        \n        if (!status.database_connection) {\n            recommendations.push('Check database connection and credentials');\n        }\n        \n        if (!status.service_availability) {\n            recommendations.push('Restart analytics service or check dependencies');\n        }\n        \n        if (metrics.responseTime > 2000) {\n            recommendations.push('Optimize database queries or add caching');\n        }\n        \n        if (metrics.memoryUsage > 500) {\n            recommendations.push('Monitor memory leaks and optimize data processing');\n        }\n        \n        if (metrics.cpuUsage > 80) {\n            recommendations.push('Scale up resources or optimize CPU-intensive operations');\n        }\n        \n        return recommendations;\n    }\n    \n    /**\n     * Hash IP address for privacy\n     */\n    hashIP(ipAddress) {\n        const crypto = require('crypto');\n        return crypto.createHash('sha256').update(ipAddress).digest('hex').substring(0, 16);\n    }\n    \n    /**\n     * Sanitize user agent string\n     */\n    sanitizeUserAgent(userAgent) {\n        // Remove potentially identifying information while keeping useful browser info\n        return userAgent.replace(/\\d+\\.\\d+\\.\\d+\\.\\d+/g, '[VERSION]');\n    }\n    \n    /**\n     * Calculate configuration changes\n     */\n    calculateConfigChanges(oldConfig, newConfig) {\n        const changes = [];\n        \n        Object.keys(newConfig).forEach(key => {\n            if (oldConfig[key] !== newConfig[key]) {\n                changes.push({\n                    field: key,\n                    old_value: oldConfig[key],\n                    new_value: newConfig[key]\n                });\n            }\n        });\n        \n        return changes;\n    }\n    \n    /**\n     * Write log entry to file\n     */\n    async writeLogEntry(logType, entry, filename = null) {\n        try {\n            const logFilename = filename || `${logType}_${new Date().toISOString().split('T')[0]}.log`;\n            const logPath = path.join(this.logDirectory, logFilename);\n            \n            const logLine = JSON.stringify(entry) + '\\n';\n            \n            await fs.appendFile(logPath, logLine);\n            \n            // Check if log rotation is needed\n            await this.checkLogRotation(logPath, logType);\n            \n        } catch (error) {\n            console.error('Failed to write log entry:', error.message);\n        }\n    }\n    \n    /**\n     * Check if log rotation is needed\n     */\n    async checkLogRotation(logPath, logType) {\n        try {\n            const stats = await fs.stat(logPath);\n            \n            if (stats.size > this.logRotationSize) {\n                await this.rotateLog(logPath, logType);\n            }\n        } catch (error) {\n            // File might not exist yet, which is fine\n        }\n    }\n    \n    /**\n     * Rotate log file\n     */\n    async rotateLog(logPath, logType) {\n        try {\n            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');\n            const rotatedPath = logPath.replace('.log', `_${timestamp}.log`);\n            \n            await fs.rename(logPath, rotatedPath);\n            \n            // Clean up old log files\n            await this.cleanupOldLogs(logType);\n            \n        } catch (error) {\n            console.error('Failed to rotate log file:', error.message);\n        }\n    }\n    \n    /**\n     * Clean up old log files\n     */\n    async cleanupOldLogs(logType) {\n        try {\n            const files = await fs.readdir(this.logDirectory);\n            const logFiles = files\n                .filter(file => file.startsWith(logType) && file.endsWith('.log'))\n                .map(file => ({\n                    name: file,\n                    path: path.join(this.logDirectory, file)\n                }));\n            \n            if (logFiles.length > this.maxLogFiles) {\n                // Sort by modification time and remove oldest files\n                const filesWithStats = await Promise.all(\n                    logFiles.map(async file => ({\n                        ...file,\n                        stats: await fs.stat(file.path)\n                    }))\n                );\n                \n                filesWithStats\n                    .sort((a, b) => a.stats.mtime - b.stats.mtime)\n                    .slice(0, filesWithStats.length - this.maxLogFiles)\n                    .forEach(async file => {\n                        await fs.unlink(file.path);\n                    });\n            }\n        } catch (error) {\n            console.error('Failed to cleanup old logs:', error.message);\n        }\n    }\n    \n    /**\n     * Log to console for development\n     */\n    logToConsole(logEntry) {\n        const { timestamp, level, operation, duration_ms, error } = logEntry;\n        const durationStr = duration_ms ? ` (${duration_ms}ms)` : '';\n        const errorStr = error ? ` - ERROR: ${error.message}` : '';\n        \n        console.log(`[${timestamp}] ${level}: ${operation}${durationStr}${errorStr}`);\n    }\n    \n    // Report generation methods (simplified implementations)\n    \n    async generateReportSummary(startDate, endDate) {\n        return {\n            total_operations: 0,\n            successful_operations: 0,\n            failed_operations: 0,\n            average_response_time_ms: 0,\n            peak_memory_usage_mb: 0\n        };\n    }\n    \n    async generatePerformanceReport(startDate, endDate) {\n        return {\n            average_query_time_ms: 0,\n            slowest_operations: [],\n            memory_usage_trend: [],\n            throughput_per_hour: []\n        };\n    }\n    \n    async generateErrorReport(startDate, endDate) {\n        return {\n            total_errors: 0,\n            error_types: {},\n            most_common_errors: [],\n            error_rate_trend: []\n        };\n    }\n    \n    async generateUserActivityReport(startDate, endDate) {\n        return {\n            active_users: 0,\n            most_active_operations: [],\n            usage_patterns: {},\n            peak_usage_hours: []\n        };\n    }\n    \n    async generateRecommendations(startDate, endDate) {\n        return [\n            'Monitor database query performance',\n            'Consider implementing caching for frequently accessed data',\n            'Review error patterns and implement additional error handling'\n        ];\n    }\n}\n\nmodule.exports = AnalyticsLogger;"