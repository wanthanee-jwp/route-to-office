import { HttpException, HttpStatus } from '@nestjs/common';

// Typed exceptions the RouteService/RoutesClientService raise. The global
// filter maps them to the display-ready messages in requirement.md §7 so we
// never surface Google's own error text to end users.

export class LocationTooFarException extends HttpException {
  constructor() {
    super(
      { message: 'Your location is too far from the office to compute a route.' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class RouteNotFoundException extends HttpException {
  constructor() {
    super(
      {
        message:
          'No driving route to the office was found. You may need to use another travel method.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class UpstreamApiException extends HttpException {
  constructor() {
    super(
      { message: 'The routing service is temporarily unavailable. Please try again shortly.' },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export class UpstreamTimeoutException extends HttpException {
  constructor() {
    super(
      { message: 'The request took too long. Please try again.' },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
}
