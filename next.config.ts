import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    webpack: config => {
        config.module.rules.push({
            test: /\.svg$/,
            use: [{ loader: '@svgr/webpack', options: { dimensions: false } }],
        });
        return config;
    },
};

export default nextConfig;
