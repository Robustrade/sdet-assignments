pipeline {
    agent any

    stages {
        stage('Test') {
            steps {
                sh 'mvn clean test'
            }
        }
        stage('Logs') {
            steps {
                archiveArtifacts artifacts: 'logs/*.log'
            }
        }
    }
}