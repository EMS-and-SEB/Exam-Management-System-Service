import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/auth.decorator.js';
import { SebClientKeyGuard } from './seb-client-key.guard.js';
import { HandshakeDto } from './validation/seb.dto.js';

@Controller('seb')
export class SebController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @UseGuards(SebClientKeyGuard)
  @Post('handshake')
  @HttpCode(HttpStatus.OK)
  handshake(@Body() _dto: HandshakeDto) {
    const handshakeToken = this.jwtService.sign(
      { type: 'seb-handshake' },
      { secret: this.configService.getOrThrow<string>('seb.handshakeSecret'), expiresIn: '30m' },
    );
    return { success: true, handshakeToken };
  }
}