module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testTimeout: 10000, // Aumenta el timeout a 10s para pruebas E2E
    modulePathIgnorePatterns: ["<rootDir>/.serverless/"],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    // Le decimos a TypeScript que el "módulo" de salida es CommonJS
                    module: 'CommonJS',
                },
            },
        ],
    },
};