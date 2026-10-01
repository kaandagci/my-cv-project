import { getStore } from '@netlify/blobs';
import { createHandler } from '../lib/visits.mjs';

export default async (req) => {
    const handler = createHandler({
        visits: getStore({ name: 'visits', consistency: 'strong' }),
        photos: getStore({ name: 'photos', consistency: 'strong' }),
        adminKey: process.env.ADMIN_KEY || ''
    });
    return handler(req);
};

export const config = { path: ['/api/visits', '/api/visits/*', '/api/photo/*'] };
