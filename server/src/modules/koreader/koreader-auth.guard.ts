import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createHash } from 'crypto';
import type { FastifyRequest } from 'fastify';

import { Permission } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { PermissionService } from '../../common/services/permission.service';
import { UserService } from '../user/user.service';
import { KoreaderRepository } from './koreader.repository';

@Injectable()
export class KoreaderAuthGuard implements CanActivate {
  constructor(
    private readonly repo: KoreaderRepository,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const username = request.headers['x-auth-user'] as string | undefined;
    const key = request.headers['x-auth-key'] as string | undefined;

    if (!username || !key) {
      throw new UnauthorizedException('Missing KOReader credentials');
    }

    const koreaderUser = await this.repo.findKoreaderUserByUsername(username);

    if (!koreaderUser) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!koreaderUser.syncEnabled) {
      throw new ForbiddenException('Sync is disabled');
    }

    const isValid = await this.verifyPassword(key, koreaderUser.passwordHash, koreaderUser.passwordMd5);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.userService.findByIdWithPermissions(koreaderUser.userId);
    if (!user || !user.active) {
      throw new UnauthorizedException('Account not found or disabled');
    }

    if (!this.permissionService.userHas(user, Permission.KoreaderSync)) {
      throw new UnauthorizedException('KOReader sync permission revoked');
    }

    const requestRecord = request as unknown as Record<string, unknown>;
    requestRecord.koreaderUserId = koreaderUser.userId;
    requestRecord.user = user satisfies RequestUser;

    return true;
  }

  private async verifyPassword(incoming: string, bcryptHash: string, md5Hash: string | null): Promise<boolean> {
    const bcryptMatch = await compare(incoming, bcryptHash);
    if (bcryptMatch) return true;

    if (md5Hash && incoming.length === 32 && /^[0-9a-f]{32}$/i.test(incoming)) {
      return incoming.toLowerCase() === md5Hash.toLowerCase();
    }

    if (md5Hash) {
      const incomingMd5 = createHash('md5').update(incoming).digest('hex');
      return incomingMd5 === md5Hash.toLowerCase();
    }

    return false;
  }
}
