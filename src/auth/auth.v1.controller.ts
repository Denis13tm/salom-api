import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { OtpRequestDto } from './dto/otp-request.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';
import { ExchangeDriverDto } from './dto/exchange-driver.dto';
import { ExchangeAdminDto } from './dto/exchange-admin.dto';
import { ExchangeOperatorDto } from './dto/exchange-operator.dto';
import { LogoutBodyDto } from './dto/logout-body.dto';
import { RefreshBodyDto } from './dto/refresh-body.dto';
import { ActivateDriverCodeDto } from './dto/activate-driver-code.dto';
import { AdminWebLoginDto } from './dto/admin-web-login.dto';
import { OperatorPasswordLoginDto } from './dto/operator-password-login.dto';

@Controller({ path: 'auth', version: '1' })
export class AuthV1Controller {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
  ) {}

  /**
   * Pilot: haydovchi UUID + exchange secret (yoki dev — secret yo‘q).
   * Keyin: OTP / parol o‘rnatiladi.
   */
  @Post('exchange/driver')
  exchangeDriver(
    @Body() body: ExchangeDriverDto,
    @Headers('x-salom-exchange-secret') secret: string | undefined,
  ) {
    return this.auth.exchangeDriverToken(body.driverId, secret);
  }

  @Post('exchange/operator')
  exchangeOperator(
    @Body() body: ExchangeOperatorDto,
    @Headers('x-salom-exchange-secret') secret: string | undefined,
  ) {
    return this.auth.exchangeOperatorToken(body.operatorId, secret);
  }

  @Post('exchange/admin')
  exchangeAdmin(
    @Body() body: ExchangeAdminDto,
    @Headers('x-salom-exchange-secret') secret: string | undefined,
  ) {
    return this.auth.exchangeAdminToken(body.adminId, secret);
  }

  /** Brauzer admin panel: `ADMIN_WEB_PASSWORD` (server env) — JWT. */
  @Post('admin/web-login')
  @HttpCode(200)
  adminWebLogin(@Body() body: AdminWebLoginDto) {
    return this.auth.loginAdminWebPassword(body.password);
  }

  /** Brauzer operator panel: telefon + parol (admin operator yaratganda beradi). */
  @Post('operator/login')
  @HttpCode(200)
  operatorPasswordLogin(@Body() body: OperatorPasswordLoginDto) {
    return this.auth.loginOperatorPassword(body.phone, body.password);
  }

  @Get('status')
  status() {
    return this.auth.authStatus();
  }

  /** Phase 18: haydovchi — `OTP_LOGIN_ENABLED=true` bo‘lishi kerak. */
  @Post('driver/otp/request')
  @HttpCode(200)
  requestDriverOtp(@Body() body: OtpRequestDto) {
    return this.otp.requestDriverOtp(body.phone);
  }

  @Post('driver/otp/verify')
  @HttpCode(200)
  verifyDriverOtp(@Body() body: OtpVerifyDto) {
    return this.otp.verifyDriverOtp(body.requestId, body.code);
  }

  /** Phase 19: admin berilgan 12 xonali kod + telefon — birinchi rasmiy kirish. */
  @Post('driver/activate-code')
  @HttpCode(200)
  activateByCode(@Body() body: ActivateDriverCodeDto) {
    return this.auth.activateDriverWithCode(body.phone, body.activationCode);
  }

  @Post('driver/registration/otp/request')
  @HttpCode(200)
  requestRegistrationOtp(@Body() body: OtpRequestDto) {
    return this.otp.requestRegistrationOtp(body.phone);
  }

  @Post('driver/registration/otp/verify')
  @HttpCode(200)
  verifyRegistrationOtp(@Body() body: OtpVerifyDto) {
    return this.otp.verifyRegistrationOtp(body.requestId, body.code);
  }

  /** Phase 12: access yangilash (refresh session rotate). */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshBodyDto) {
    return this.auth.refreshTokens(body.refreshToken);
  }

  /** Bitta refresh sessionni bekor qilish. */
  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: LogoutBodyDto) {
    return this.auth.logoutWithRefreshToken(body.refreshToken);
  }

  /** Bearer access bilan barcha refresh sessionlarni bekor (revoke). */
  @Post('logout/all')
  @HttpCode(200)
  logoutAll(@Headers('authorization') auth?: string) {
    return this.auth.logoutAllSessions(auth);
  }
}
