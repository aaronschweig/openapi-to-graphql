import openapi from './openapi.json';
import {
  GraphQLString,
  GraphQLScalarType,
  GraphQLList,
  GraphQLType,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLInputObjectType,
  GraphQLBoolean,
  GraphQLInputType,
  printSchema,
  GraphQLSchema,
  GraphQLInt,
  GraphQLFieldConfig,
} from 'graphql';

import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  SchemaObject,
  PathItemObject,
  OperationObject,
  ParameterObject,
  OpenAPIObject,
} from './openapi.interface';
import axios from 'axios';
import { ApolloServer } from 'apollo-server';

// ======================================
// ======================================
//              HELPERS
// ======================================
// ======================================

const wrapRequired = (
  t: GraphQLScalarType | GraphQLList<GraphQLType> | GraphQLObjectType,
  isRequired: boolean
) => (isRequired ? new GraphQLNonNull(t) : t);

const reduceArrayToObject = (prev: any, curr: any) => {
  if (!curr) {
    return prev;
  }
  prev[Object.keys(curr)[0]] = curr[Object.keys(curr)[0]];
  return prev;
};

const getSchema = (config: OpenAPIObject) => config?.components?.schemas ?? {};

const extractGetOrDeleteRequest = (
  requstObject: PathItemObject
): {
  req: OperationObject | undefined;
  type: 'get' | 'delete';
} => ({
  req: requstObject.get || requstObject.delete,
  type: requstObject.get ? 'get' : 'delete',
});

const extractResponse = (
  opObject: OperationObject,
  resposeCode: string = '200'
) =>
  (opObject.responses[resposeCode]?.content ?? {})['application/json']?.schema;

const extractParameters = (par: ParameterObject[]) =>
  par.map((p) => ({
    name: p.name,
    type: parseGQLType(p.schema ?? {}, p.required!),
  }));

const replacePathParamWithArg = (path: string, args: any) =>
  path.replace(/{([a-zA-z]+)}/, (sub) => args[sub.replace(/[{}]/g, '')]);

const parseGQLType = (
  schemaObject: SchemaObject,
  isRequired: boolean
): GraphQLType => {
  switch (schemaObject.type!) {
    case 'string':
      return wrapRequired(GraphQLString, isRequired);
      break;
    case 'array':
      return new GraphQLList(parseGQLType(schemaObject.items!, isRequired));
      break;
    case 'boolean':
      return wrapRequired(GraphQLBoolean, isRequired);
      break;
    case 'number':
      return wrapRequired(GraphQLInt, isRequired);
      break;
    case 'object':
      // TODO: Was da los
      return wrapRequired(GraphQLString, isRequired);
      break;
    default:
      // Es ist eine $ref
      if (!schemaObject.$ref) {
        return GraphQLString;
      }
      const refSpit = schemaObject.$ref!.split('/');
      return TypesMap.get(refSpit[refSpit.length - 1])!;
  }
};

// ======================================
// ======================================
//              PARSER
// ======================================
// ======================================

const TypesMap = new Map<string, GraphQLType>();

const schema = getSchema(openapi as any);

let inputTypes = Object.keys(schema).filter((k) =>
  k.toLowerCase().includes('dto')
);

let objectTypes = Object.keys(schema).filter(
  (k) => !k.toLowerCase().includes('dto')
);

inputTypes = Array.from(new Set(inputTypes));

objectTypes = Array.from(new Set(objectTypes));

const parsedTypes = [...inputTypes, ...objectTypes].map((type) => {
  const definition = schema[type];
  const fields = Object.keys(definition.properties ?? {})
    .map((k) => {
      const propertyDefintion = definition.properties![k];
      const isRequired = definition.required?.includes(k) ?? false;

      return {
        [k]: {
          type: parseGQLType(propertyDefintion, isRequired),
          description: propertyDefintion.description,
        } as GraphQLFieldConfig<any, any>,
      };
    })
    .reduce(reduceArrayToObject, {});
  const gqlType = inputTypes.includes(type)
    ? new GraphQLInputObjectType({
        name: type,
        fields,
      })
    : new GraphQLObjectType({
        name: type,
        fields,
      });
  TypesMap.set(gqlType.name, gqlType);
  return gqlType;
});

// Responses aus den Paths ziehen und auch als Types parsen, wenn noch was fehlt

const paths = openapi.paths;

const queryFields = Object.keys(openapi.paths ?? {})
  .map((k) => {
    const { req, type: reqType } = extractGetOrDeleteRequest((paths as any)[k]);
    if (!req) {
      return;
    }
    const response = extractResponse(req ?? {}) ?? {};

    const params = extractParameters(req.parameters ?? []);

    return {
      [req.operationId ?? '']: {
        type: parseGQLType(response, false),
        args: params.reduce((prev: any, curr: any) => {
          prev[curr.name] = { type: curr.type };
          return prev;
        }, {}),
        resolve: async (_source, args, ctx, _info) => {
          const path = replacePathParamWithArg(k, args);
          // TODO: use OpenAPI.server als Config für den endpoint
          const { data } = await axios[reqType](
            'http://localhost:3000' + path,
            {
              headers: {
                authorization: ctx.req.headers.authorization,
              },
            }
          );
          return data;
        },
      } as GraphQLFieldConfig<any, any>,
    };
  })
  .reduce(reduceArrayToObject, {});

// Mutations noch parsen: requestBody und die Responses von dort

const rawSchema = new GraphQLSchema({
  query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
  types: parsedTypes,
});

// const server = new ApolloServer({
//   schema: rawSchema,
//   context: ({ req }) => ({ req }),
// });

// server.listen(3001).then(() => console.log('READY'));

const gqlSchema = printSchema(rawSchema);

writeFileSync(join(__dirname, '..', 'schema.gql'), gqlSchema);
