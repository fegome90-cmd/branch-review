module.exports = {
  apps: [
    {
      name: 'branch-review-api',
      script: 'bun',
      args: '.next/standalone/server.js',
      cwd: '/Users/felipe_gonzalez/Developer/branch-review',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOSTNAME: 'localhost',
        // Set REVIEW_API_TOKEN in environment or .env file
        // REVIEW_API_TOKEN: 'your-token-here',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOSTNAME: '0.0.0.0',
        // REVIEW_API_TOKEN: 'your-token-here',
      },
      env_file: '.env',
      error_file: '.pm2/logs/branch-review-error.log',
      out_file: '.pm2/logs/branch-review-out.log',
      log_file: '.pm2/logs/branch-review.log',
      time: true,
    },
  ],
};
