import WebSocket from 'ws';

/**
 * Un cliente de prueba que encapsula una conexión WebSocket y sus mensajes.
 */
export class WsTestClient {
    public ws!: WebSocket;
    private messages: any[] = [];
    private messageListeners: Map<string, (msg: any) => void> = new Map();

    constructor(private url: string) { }

    /** Abre la conexión */
    connect(): Promise<void> {
        this.ws = new WebSocket(this.url);

        // Inicia el listener principal
        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data as string);
                this.messages.push(msg); // Guarda todos los mensajes

                // Revisa si alguien está "esperando" este mensaje
                if (this.messageListeners.has(msg.action)) {
                    this.messageListeners.get(msg.action)!(msg);
                }
            } catch (e) {
                console.error("Error al parsear mensaje WS:", event.data);
            }
        };

        return new Promise((resolve) => {
            this.ws.onopen = () => resolve();
        });
    }

    /** Envía un mensaje JSON */
    send(data: object) {
        this.ws.send(JSON.stringify(data));
    }

    /** Cierra la conexión */
    close() {
        if (this.ws) this.ws.close();
    }

    /**
     * Devuelve una Promesa que se resuelve cuando se recibe
     * un mensaje con la 'action' específica.
     */
    waitForMessage(action: string, timeout = 5000): Promise<any> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout: Esperando ${action}, pero nunca llegó.`));
                this.messageListeners.delete(action);
            }, timeout);

            this.messageListeners.set(action, (msg) => {
                clearTimeout(timer);
                resolve(msg);
                this.messageListeners.delete(action);
            });
        });
    }

    // --- Flujos de App Encapsulados ---

    async authenticate(token: string) {
        const promise = this.waitForMessage("auth-success");
        this.send({ action: "authenticate", token });
        return promise;
    }

    async subscribe(view: string) {
        const promise = this.waitForMessage("subscribe-success"); // Asumiendo que tu Lambda 'subscribe' responde así
        this.send({ action: "subscribe", view });
        return promise;
    }
}