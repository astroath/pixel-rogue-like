import { Component } from './Component';

export class EnemyInfoComponent extends Component {
    public name = 'EnemyInfo';
    public enemyType: string;
    public xpReward: number;

    constructor(enemyType: string, xpReward: number = 1) {
        super();
        this.enemyType = enemyType;
        this.xpReward = xpReward;
    }
}
