const { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } = require('@aws-sdk/client-ssm');

const sourceSSM = new SSMClient({ region: process.env.AWS_DEFAULT_REGION });
const targetSSM = new SSMClient({ region: process.env.AWS_TARGET_REGION });

const checkTarget = async (event) => {
  try {
    // check if target exists already
    const command = new GetParameterCommand({
      Name: event.detail.name,
      WithDecryption: true
    });
    return await targetSSM.send(command);
  } catch (error) {
    // we will consider a ParameterNotFound response from the target a non error
    if (error.name !== 'ParameterNotFound') {
      throw error;
    }
    return null;
  }
};

const update = async (event) => {
  // get the source value
  const sourceCommand = new GetParameterCommand({
    Name: event.detail.name,
    WithDecryption: true
  });
  const sourceParam = await sourceSSM.send(sourceCommand);

  const targetParam = await checkTarget(event);
  if (!targetParam || targetParam.Parameter.Value !== sourceParam.Parameter.Value || targetParam.Parameter.Type !== sourceParam.Parameter.Type) {
    // remove the version
    delete sourceParam.Parameter.Version;
    // enable overwrites
    sourceParam.Parameter.Overwrite = true;
    const putCommand = new PutParameterCommand(sourceParam.Parameter);
    return await targetSSM.send(putCommand);
  } else {
    console.log(`Parameter ${event.detail.name} is already in ${process.env.AWS_TARGET_REGION} with the same value and type, ignoring`);
    return null;
  }
};

const remove = async (event) => {
  try {
    const deleteCommand = new DeleteParameterCommand({
      Name: event.detail.name
    });
    return await targetSSM.send(deleteCommand);
  } catch (error) {
    if (error.name === 'ParameterNotFound') {
      console.log(`Parameter ${event.detail.name} was not found in ${process.env.AWS_TARGET_REGION}, ignoring`);
      return null;
    }
    throw error;
  }
};

const operations = {
  Create: update,
  Update: update,
  Delete: remove
};

exports.replicate = async (event, context, callback) => {
  console.log(JSON.stringify(event));
  try {
    if (event.detail.operation in operations) {
      const success = await operations[event.detail.operation](event);
      if (success) {
        console.log(`${event.detail.operation} result:\n${JSON.stringify(success)}`);
      }
    } else {
      console.log(`Unknown operation "${event.detail.operation}":\n ${JSON.stringify(event)}`);
    }
  } catch (error) {
    console.log(`Operation failed for\n ${JSON.stringify(event)}\n${JSON.stringify(error)}`);
    if (error.retryable) {
      return callback(error);
    }
  }
  return callback(null, 'OK');
};