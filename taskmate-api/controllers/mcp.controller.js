const express = require('express');
const router = express.Router();
const { execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const PYTHON_LLM_SERVICE_BASE_URL = 'http://localhost:8001';

router.post('/', async (req, res) => {
  const { type, sender, receiver, payload } = req.body;
  console.log(`MCP Message Received: Type=${type}, Sender=${sender}, Receiver=${receiver}, Payload=${JSON.stringify(payload)}`);

  if (!type || !sender || !receiver || !payload) {
    console.log('Invalid MCP message: Missing fields');
    return res.status(400).json({ error: 'Invalid MCP message' });
  }

  if (receiver === 'McpServer') {
    if (payload.action === 'save_tasks') {
      console.log('MCP Server Action: Saving tasks to the database.');
      // TODO: Implement database logic
      return res.status(200).json({ message: 'Tasks successfully saved' });
    } else {
      console.log(`MCP Server Action: Unknown action - ${payload.action}`);
      return res.status(400).json({ error: 'Unknown action for McpServer' });
    }
  } else if (receiver === 'RecommendationsAgent') {
    console.log(`Routing message to Python RecommendationsAgent: ${receiver}`);
    try {
      const response = await fetch(`${PYTHON_LLM_SERVICE_BASE_URL}/generate_response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: payload.idea }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error from Python LLM service: ${response.status} - ${errorText}`);
        return res.status(response.status).json({ error: `Error from Python LLM service: ${errorText}` });
      }

      const pythonResponse = await response.json();
      let rawJsonString = pythonResponse.response;

      // Attempt to extract JSON from markdown code block if present
      const jsonMatch = rawJsonString.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch && jsonMatch[1]) {
        rawJsonString = jsonMatch[1];
      }

      let parsedRecommendations;
      try {
        parsedRecommendations = JSON.parse(rawJsonString);
      } catch (jsonError) {
        console.error('Failed to parse JSON from Python LLM response:', jsonError);
        console.error('Raw Python LLM response:', rawJsonString);
        return res.status(500).json({ error: 'Invalid JSON format from Python LLM service' });
      }

      const responsePayload = { recommendations: parsedRecommendations };

      console.log(`Agent ${receiver} responded with: ${JSON.stringify(responsePayload)}`);
      res.status(200).json({
        type: 'response',
        sender: receiver,
        receiver: sender,
        payload: responsePayload
      });
    } catch (error) {
      console.error('Error calling Python LLM service:', error);
      res.status(500).json({ error: 'Failed to communicate with Python LLM service' });
    }
  } else {
    console.log(`Agent '${receiver}' not found in registry.`);
    res.status(404).json({ error: `Agent '${receiver}' not found` });
  }
});

router.post('/tasks', async (req, res) => {
    const { user_id, project_name, project_description, tasks, milestones } = req.body;
    console.log(`Received /tasks request: User=${user_id}, Project=${project_name}, Description=${project_description}, Tasks=${JSON.stringify(tasks)}, Milestones=${JSON.stringify(milestones)}`);

    if (!user_id || !project_name || !tasks || !milestones) {
        console.log('Invalid /tasks request: Missing user_id, project_name, tasks, or milestones');
        return res.status(400).json({ error: 'Invalid request' });
    }

    const groupId = uuidv4();
    console.log(`Generated new Group ID: ${groupId}`);

    try {
        // Create the group
        console.log(`Inserting new group: ${project_name} with ID ${groupId} for user ${user_id}`);
        await execWriteCommand(
            'INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @adminId, @name)',
            [
                { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId },
                { name: 'adminId', type: TYPES.UniqueIdentifier, value: user_id },
                { name: 'name', type: TYPES.VarChar, value: project_name }
            ]
        );

        // Add the user who created the group as a member
        console.log(`Adding user ${user_id} to group ${groupId}`);
        await execWriteCommand(
            'INSERT INTO dbo.UserGroups (uid, gid) VALUES (@uid, @gid)',
            [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: user_id },
                { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
            ]
        );

        // Create the tasks
        console.log(`Inserting ${tasks.length} tasks for group ${groupId}`);
        for (const task of tasks) {
            const taskId = uuidv4();
            console.log(`Inserting task: ${task.name} with ID ${taskId}`);
            await execWriteCommand(
                'INSERT INTO dbo.Tasks (tid, gid, name, description, list, datetime, percentage) VALUES (@tid, @gid, @name, @description, @list, @datetime, @percentage)',
                [
                    { name: 'tid', type: TYPES.UniqueIdentifier, value: taskId },
                    { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId },
                    { name: 'name', type: TYPES.VarChar, value: task.name },
                    { name: 'description', type: TYPES.VarChar, value: task.description },
                    { name: 'list', type: TYPES.VarChar, value: task.status || 'To Do' }, // Use provided status or default
                    { name: 'datetime', type: TYPES.SmallDateTime, value: new Date(task.due_date) }, // Use provided due_date
                    { name: 'percentage', type: TYPES.Int, value: 0 }
                ]
            );
        }

        // Create the milestones (nodes)
        console.log(`Inserting ${milestones.length} milestones for group ${groupId}`);
        for (const milestone of milestones) {
            const nodeId = uuidv4();
            console.log(`Inserting milestone: ${milestone.name} with ID ${nodeId}`);
            await execWriteCommand(
                'INSERT INTO dbo.Nodes (nid, gid, name, description, date, completed, x_pos, y_pos, percentage, connections) VALUES (@nid, @gid, @name, @description, @date, @completed, @x_pos, @y_pos, @percentage, @connections)',
                [
                    { name: 'nid', type: TYPES.UniqueIdentifier, value: nodeId },
                    { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId },
                    { name: 'name', type: TYPES.VarChar, value: milestone.name },
                    { name: 'description', type: TYPES.VarChar, value: milestone.description },
                    { name: 'date', type: TYPES.Date, value: new Date(milestone.date) },
                    { name: 'completed', type: TYPES.Bit, value: false },
                    { name: 'x_pos', type: TYPES.Float, value: 0 }, // Default value
                    { name: 'y_pos', type: TYPES.Float, value: 0 }, // Default value
                    { name: 'percentage', type: TYPES.Int, value: 0 }, // Default value
                    { name: 'connections', type: TYPES.Int, value: 0 } // Default value
                ]
            );
        }

        console.log('Project, tasks, and milestones successfully saved to database.');
        res.status(200).json({ message: 'Project, tasks, and milestones successfully saved' });
    } catch (error) {
        console.error('Database Error: Failed to save project, tasks, or milestones', error);
        res.status(500).json({ error: 'Failed to save project, tasks, or milestones' });
    }
});

module.exports = router;
