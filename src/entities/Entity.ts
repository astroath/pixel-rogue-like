import { Component } from './components/Component';

export class Entity {
    public id: number;
    public type: string;
    public active: boolean = true;
    public flags: {
        collidable: boolean;
        movable: boolean;
        damageable: boolean;
        hostile: boolean;
    } = { collidable: true, movable: true, damageable: true, hostile: false };
    private components: Map<string, Component> = new Map();

    constructor(id: number, type: string) {
        this.id = id;
        this.type = type;
    }

    public addComponent<C extends Component>(component: C): void {
        this.components.set(component.name, component);
    }

    public getComponent<T extends Component>(name: string): T | undefined {
        return this.components.get(name) as T | undefined;
    }

    public removeComponent(name: string): void {
        this.components.delete(name);
    }
}

