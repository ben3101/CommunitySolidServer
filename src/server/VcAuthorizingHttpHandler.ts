import type { Credentials } from '../authentication/Credentials';
import type { CredentialsExtractor } from '../authentication/CredentialsExtractor';
import { VcExtractor } from '../authentication/VcExtractor';
import type { Authorizer } from '../authorization/Authorizer';
import type { PermissionReader } from '../authorization/PermissionReader';
import type { ModesExtractor } from '../authorization/permissions/ModesExtractor';
import { Operation } from '../http/Operation';
import type { ResponseDescription } from '../http/output/response/ResponseDescription';
import { getLoggerFor } from '../logging/LogUtil';
import { readJsonStream } from '../util/StreamUtil';
import { HttpRequest } from './HttpRequest';
import type { OperationHttpHandlerInput } from './OperationHttpHandler';
import { OperationHttpHandler } from './OperationHttpHandler';

export interface VcAuthorizingHttpHandlerArgs {
  /**
   * Extracts the credentials from the incoming request.
   */
  credentialsExtractor: VcExtractor;
  /**
   * Extracts the required modes from the generated Operation.
   */
  modesExtractor: ModesExtractor;
  /**
   * Reads the permissions available for the Operation.
   */
  permissionReader: PermissionReader;
  /**
   * Verifies if the requested operation is allowed.
   */
  authorizer: Authorizer;
  /**
   * Handler to call if the operation is authorized.
   */
  operationHandler: OperationHttpHandler;
}


/**
 * Handles all the necessary steps for an authorization.
 * Errors if authorization fails, otherwise passes the parameter to the operationHandler handler.
 * The following steps are executed:
 *  - Extracting credentials from the request.
 *  - Extracting the required permissions.
 *  - Reading the allowed permissions for the credentials.
 *  - Validating if this operation is allowed.
 */
export class VcAuthorizingHttpHandler extends OperationHttpHandler {
  private readonly logger = getLoggerFor(this);

  private readonly credentialsExtractor: VcExtractor;
  private readonly modesExtractor: ModesExtractor;
  private readonly permissionReader: PermissionReader;
  private readonly authorizer: Authorizer;
  private readonly operationHandler: OperationHttpHandler;

  public constructor(args: VcAuthorizingHttpHandlerArgs) {
    super();
    this.credentialsExtractor = args.credentialsExtractor;
    this.modesExtractor = args.modesExtractor;
    this.permissionReader = args.permissionReader;
    this.authorizer = args.authorizer;
    this.operationHandler = args.operationHandler;
  }

  public async handle(input: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const { request, operation } = input;
    let body: NodeJS.Dict<any> = await readJsonStream(operation.body.data);
    const credentials: Credentials = await this.credentialsExtractor.getCredentials(body);

    this.logger.verbose(`Extracted credentials: ${JSON.stringify(credentials)}`);

    const requestedModes = await this.modesExtractor.handleSafe(operation);
    this.logger.verbose(`Retrieved required modes: ${
      [ ...requestedModes.entrySets() ].map(([ id, set ]): string => `{ ${id.path}: ${[ ...set ]} }`)
    }`);

    const availablePermissions = await this.permissionReader.handleSafe({ credentials, requestedModes });
    this.logger.verbose(`Available permissions are ${
      [ ...availablePermissions.entries() ].map(([ id, map ]): string => `{ ${id.path}: ${JSON.stringify(map)} }`)
    }`);

    try {
      await this.authorizer.handleSafe({ credentials, requestedModes, availablePermissions });
    } catch (error: unknown) {
      this.logger.verbose(`Authorization failed: ${(error as any).message}`);
      throw error;
    }

    this.logger.verbose(`Authorization succeeded, calling source handler`);

    return this.operationHandler.handleSafe(input);
  }

  //check acr has appropriate combo for user, app, issuer
  public async checkAcr(operation: Operation, request: HttpRequest): Promise<boolean>{
    const credentials: Credentials = await this.credentialsExtractor.handleSafe(request);
    this.logger.info(`Extracted credentials: ${JSON.stringify(credentials)}`);

    const requestedModes = await this.modesExtractor.handleSafe(operation);
    this.logger.info(`Retrieved required modes: ${
      [ ...requestedModes.entrySets() ].map(([ id, set ]): string => `{ ${id.path}: ${[ ...set ]} }`)
    }`);

    const availablePermissions = await this.permissionReader.handleSafe({ credentials, requestedModes });
    this.logger.info(`Available permissions are ${
      [ ...availablePermissions.entries() ].map(([ id, map ]): string => `{ ${id.path}: ${JSON.stringify(map)} }`)
    }`);

    //return true if any permissions are available to this combination of user/app/issuer as this means there is a match
    return (Array.from(availablePermissions.values()).some((value) => value.read === true));
  }
  
}