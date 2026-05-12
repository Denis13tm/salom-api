import { Body, Controller, Post } from "@nestjs/common";
import { RegistrationService } from "./registration.service";
import { RegisterDriverDto } from "./dto/register-driver.dto";

@Controller({ path: "public/drivers", version: "1" })
export class PublicDriverController {
  constructor(private readonly reg: RegistrationService) {}

  @Post("register")
  register(@Body() body: RegisterDriverDto) {
    return this.reg.publicRegister(body);
  }
}
