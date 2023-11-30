import type { RequestParser } from '../http/input/RequestParser';
import type { ErrorHandler } from '../http/output/error/ErrorHandler';
import { ResponseDescription } from '../http/output/response/ResponseDescription';
import type { ResponseWriter } from '../http/output/ResponseWriter';
import { getLoggerFor } from '../logging/LogUtil';
import { assertError } from '../util/errors/ErrorUtil';
import { HttpError } from '../util/errors/HttpError';
import type { HttpHandlerInput } from './HttpHandler';
import { HttpHandler } from './HttpHandler';
import type { HttpRequest } from './HttpRequest';
import type { HttpResponse } from './HttpResponse';
import type { OperationHttpHandler } from './OperationHttpHandler';
import { BasicRepresentation } from '../http/representation/BasicRepresentation';

//based on ParsingHTTPHandler
export interface VcHttpHandlerArgs {
  /**
   * Parses the incoming requests.
   */
  requestParser: RequestParser;
  /**
   * Converts errors to a serializable format.
   */
  errorHandler: ErrorHandler;
  /**
   * Writes out the response of the operation.
   */
  responseWriter: ResponseWriter;
  /**
   * Handler to send the operation to.
   */
  operationHandler: OperationHttpHandler;

}

/**
 * Parses requests and sends the resulting {@link Operation} to the wrapped {@link OperationHttpHandler}.
 * Errors are caught and handled by the {@link ErrorHandler}.
 * In case the {@link OperationHttpHandler} returns a result it will be sent to the {@link ResponseWriter}.
 */
export class VcHttpHandler extends HttpHandler {
  private readonly logger = getLoggerFor(this);

  private readonly requestParser: RequestParser;
  private readonly errorHandler: ErrorHandler;
  private readonly responseWriter: ResponseWriter;
  private readonly operationHandler: OperationHttpHandler; //this should be an authorizinghttphandler - use to check initial message
  //maybe make a specific class for it and slot it into the config file at vc-http-handler.json,

  public constructor(args: VcHttpHandlerArgs) {
    super();
    this.requestParser = args.requestParser;
    this.errorHandler = args.errorHandler;
    this.responseWriter = args.responseWriter;
    this.operationHandler = args.operationHandler;
  }

  public async handle({ request, response }: HttpHandlerInput): Promise<void> {
    let result: ResponseDescription;

      try {
        result = await this.handleRequest(request, response);
      } catch (error: unknown) {
        result = await this.handleError(error, request);
      }

      if (result) {
        this.logger.info('Sending Response...');
        return await this.responseWriter.handleSafe({ response, result });
      }
  }

  //This handler will only respond to requests that have a vc issuer, app and user name in the header
  //Or if it has a nonce and domain (uri)
  public async canHandle({ request, response }: HttpHandlerInput): Promise<void> {  
    if((request.headers['vcissuer'] !== undefined && 
    request.headers['app'] !== undefined && 
    request.headers['user'] !== undefined)
    || (request.headers['nonce'] !== undefined && request.headers['uri'] !== undefined)//test code until i know what to check for detecting VP message
  ){
    }else{
      throw new Error('VC headers missing: vcissuer, app, user, or nonce and domain (uri).');
    }
  }

  /**
   * Interprets the request and passes the generated Operation object to the stored OperationHttpHandler.
   */
  protected async handleRequest(request: HttpRequest, response: HttpResponse):
  Promise<ResponseDescription> {

    //handle if it is the initial request
    if(this.isInitialRequest(request)){
      this.logger.info('Detected Initial Request');
      //check the vc headers are valid for the requested resource
      if(await this.validUserAppIssuer(request, response)){
        return await this.handleInitialRequest(request, response);
      }else{
        throw new Error('Invalid user - app - issuer combination.');
      }
      
      //else it is the secondary request, proceed with authorization checks to verify VP
    }else if(this.isSecondaryRequest(request)){
      this.logger.info('Detected Secondary Request');
      this.logger.info(`Nonce: ${request.headers['nonce']} URI: ${request.headers['uri']}`);

      //check nonce and uri are correct
      

      //verify VP
      
      //if valid, get authorizer to approve operation
      //TODO...return some way of approving it...
    }

    const operation = await this.requestParser.handleSafe(request);

    //operationHandler should be instance of VcAuthorizingHttpHandler.
    const result = await this.operationHandler.handleSafe({ operation, request, response });
    //result from VcAuthorizingHttpHandler gets returned and written into response outputted
    this.logger.verbose(`Parsed ${operation.method} operation on ${operation.target.path}`);
    return result;
  }

  /**
   * Handles the error output correctly based on the preferences.
   */
  protected async handleError(error: unknown, request: HttpRequest): Promise<ResponseDescription> {
    assertError(error);
    const result = await this.errorHandler.handleSafe({ error, request });
    if (HttpError.isInstance(error) && result.metadata) {
      const quads = error.generateMetadata(result.metadata.identifier);
      result.metadata.addQuads(quads);
    }
    return result;
  }

  /**
   * VC request checking code?
   * -
   * - 
   * - create VP request, include nonce and store nonce for later check
   * 
   */

  //TODO - checks ACP policy to see if user, app, issuer combination match requested resource's access rules
  public async validUserAppIssuer(request: HttpRequest, response: HttpResponse) : Promise<boolean>{
    //TODO
    //this should check acr file. If it returns true the permissions match, otherwise it threw an error 
    try{
      const operation = await this.requestParser.handleSafe(request);
      const result = await this.operationHandler.handleSafe({ operation, request, response });
      this.logger.info("Valid User/App/Issuer combination");
      return true;
    }catch(e){
      this.logger.info("Invalid User/App/Issuer combination");
      return false;
    }
  }

  public isInitialRequest(request: HttpRequest) : boolean{
    return (request.headers['vcissuer'] !== undefined && 
    request.headers['app'] !== undefined && 
    request.headers['user'] !== undefined);
  }

  public isSecondaryRequest(request: HttpRequest) : boolean{
    //just test code that checks that it has a nonce in the header
    return request.headers['nonce'] !== undefined && request.headers['uri'] !== undefined;
  }


  public async handleInitialRequest(request: HttpRequest, response: HttpResponse) : Promise<ResponseDescription>{
    //generate a dummy http response to test server responding in event it accepted vcissuer/app/user
    //const nonce = crypto.randomUUID();
    const crypto = require('crypto');
    const nonce = crypto.randomBytes(16).toString('base64');
    this.logger.info(`Generated Nonce: ${nonce}`);
    const uri = request.url;

    //TODO - find way to save nonce and uri for check when receiving VP

    let result : ResponseDescription = new ResponseDescription(401);

    //TODO - proper way to generate VPreq
    //https://w3c-ccg.github.io/vp-request-spec/#browser-credential-handler-api-chapi placeholder
    let VPrequest = {
      "VerifiablePresentation": {
        "query": {
          "type": "QueryByExample",
          "credentialQuery": {
            "reason": "We need you to prove your eligibility to work.",
            "example": {
              "@context": [
                "https://www.w3.org/2018/credentials/v1",
                "https://w3id.org/citizenship/v1"
              ],
              "type": "PermanentResidentCard"
            }
          }
        },
        "challenge": nonce,
        "domain": uri
      },
      "recommendedHandlerOrigins": [
        "https://wallet.example"
      ]
    };
    const representation = new BasicRepresentation(JSON.stringify(VPrequest), 'application/ld+json');
    result.data = representation.data;
    return result;
  }

  /**
   * VP checking code?
   * - authorizinghttphandler?
   */
  
}
