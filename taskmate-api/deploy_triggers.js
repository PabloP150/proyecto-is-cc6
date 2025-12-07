const { execWriteCommand, execReadCommand } = require('./helpers/execQuery');
const fs = require('fs');
const path = require('path');

async function deployTriggers() {
    try {
        console.log('🔄 Starting triggers deployment...');
        
        // Step 1: Check and drop existing triggers
        console.log('📋 Checking for existing triggers...');
        const checkQuery = `
            SELECT name FROM sys.triggers 
            WHERE name IN ('UpdateTargetNodePercentage', 'UpdateTargetOnPrerequisiteChange')
        `;
        
        const existingTriggers = await execReadCommand(checkQuery);
        
        for (const trigger of existingTriggers) {
            console.log(`🗑️  Dropping existing trigger: ${trigger.name}...`);
            const dropQuery = `DROP TRIGGER dbo.${trigger.name}`;
            await execWriteCommand(dropQuery);
            console.log(`✅ Trigger ${trigger.name} dropped successfully`);
        }
        
        if (existingTriggers.length === 0) {
            console.log('ℹ️  No existing triggers found');
        }
        
        // Step 2: Read and execute new triggers
        console.log('📄 Reading triggers from file...');
        const triggerPath = path.join(__dirname, 'taskmate_triggers.sql');
        const triggerSQL = fs.readFileSync(triggerPath, 'utf8');
        
        // Split triggers by CREATE TRIGGER statements
        const triggers = triggerSQL.split(/(?=CREATE TRIGGER)/i).filter(t => t.trim());
        
        console.log(`🚀 Creating ${triggers.length} triggers...`);
        
        for (let i = 0; i < triggers.length; i++) {
            const trigger = triggers[i].trim();
            if (trigger) {
                console.log(`   Creating trigger ${i + 1}/${triggers.length}...`);
                await execWriteCommand(trigger);
            }
        }
        
        console.log('✅ New triggers created successfully!');
        
        // Step 3: Verify triggers were created
        console.log('🔍 Verifying trigger creation...');
        const verifyTriggers = await execReadCommand(checkQuery);
        
        if (verifyTriggers.length === 2) {
            console.log('🎉 Triggers deployment completed successfully!');
            console.log('📊 Node percentage trigger: Calculates averages for progressor mode');
            console.log('🔄 Edge prerequisite trigger: Updates percentages when switching modes');
        } else {
            console.log(`⚠️  Expected 2 triggers, found ${verifyTriggers.length}`);
            verifyTriggers.forEach(t => console.log(`   - ${t.name}`));
        }
        
    } catch (error) {
        console.error('💥 Error during triggers deployment:', error.message);
        process.exit(1);
    }
}

// Run the deployment
deployTriggers();