import { restormelResolve } from '../src/lib/server/restormel';

const result = await restormelResolve({
  environmentId: process.env.RESTORMEL_ENVIRONMENT_ID ?? 'production'
});

console.log('Resolved:', JSON.stringify(result, null, 2));
