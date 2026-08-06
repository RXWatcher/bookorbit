import { SetMetadata } from '@nestjs/common';

export const SUPERUSER_KEY = 'superuser';
export const RequireSuperuser = () => SetMetadata(SUPERUSER_KEY, true);
